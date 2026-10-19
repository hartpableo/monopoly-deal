<?php
declare(strict_types=1);

require_once __DIR__ . '/cards.php';

class GameEngine {
    public static function createGame(string $hostName): array {
        $name = trim($hostName);
        if ($name === '') {
            throw new Exception("Player name is required.");
        }
        $hostId = 'p_' . bin2hex(random_bytes(4));
        return [
            'status' => 'lobby', // 'lobby' | 'playing' | 'finished'
            'deck' => CardDefinitions::createDeck(),
            'discard' => [],
            'players' => [
                $hostId => [
                    'id' => $hostId,
                    'name' => $name,
                    'hand' => [],
                    'bank' => [],
                    'property_sets' => [], // color => [cards...]
                    'is_host' => true,
                ],
            ],
            'turn_order' => [$hostId],
            'turn' => [
                'active_player_id' => $hostId,
                'actions_left' => 3,
                'turn_number' => 0,
                'rent_multiplier' => 1,
            ],
            'winner_id' => null,
            'pending_payment' => null,
            'pending_action' => null,
            'logs' => [
                ['time' => time(), 'text' => "Game lobby created by " . htmlspecialchars($name)]
            ],
        ];
    }

    public static function joinGame(array &$state, string $playerName): string {
        if ($state['status'] !== 'lobby') {
            throw new Exception("Game is already in progress.");
        }
        if (count($state['players']) >= 5) {
            throw new Exception("Game room is full (max 5 players).");
        }

        $name = trim($playerName);
        if ($name === '') {
            throw new Exception("Player name is required.");
        }

        $playerId = 'p_' . bin2hex(random_bytes(4));
        $state['players'][$playerId] = [
            'id' => $playerId,
            'name' => $name,
            'hand' => [],
            'bank' => [],
            'property_sets' => [],
            'is_host' => false,
        ];
        $state['turn_order'][] = $playerId;

        self::addLog($state, "{$name} joined the game.");
        return $playerId;
    }

    public static function removePlayerFromLobby(array &$state, string $hostId, string $targetPlayerId): void {
        if ($state['status'] !== 'lobby') {
            throw new Exception("Players can only be removed while in the lobby.");
        }
        if (empty($state['players'][$hostId]['is_host'])) {
            throw new Exception("Only the host can remove players.");
        }
        if ($hostId === $targetPlayerId) {
            throw new Exception("The host cannot be removed.");
        }
        if (!isset($state['players'][$targetPlayerId])) {
            throw new Exception("Player not found in game.");
        }

        $targetName = $state['players'][$targetPlayerId]['name'] ?? 'Player';
        unset($state['players'][$targetPlayerId]);
        $state['turn_order'] = array_values(array_filter($state['turn_order'], fn($id) => $id !== $targetPlayerId));

        self::addLog($state, "{$targetName} was removed from the lobby by host.");
    }

    public static function startGame(array &$state, string $playerId): void {
        if ($state['status'] !== 'lobby') {
            throw new Exception("Game already started.");
        }
        if (empty($state['players'][$playerId]['is_host'])) {
            throw new Exception("Only the host can start the game.");
        }
        if (count($state['players']) < 2) {
            throw new Exception("Need at least 2 players to start.");
        }

        $state['status'] = 'playing';

        // Deal 5 cards to each player
        foreach ($state['players'] as $pid => &$player) {
            for ($i = 0; $i < 5; $i++) {
                if (!empty($state['deck'])) {
                    $player['hand'][] = array_shift($state['deck']);
                }
            }
        }
        unset($player);

        $firstPlayerId = $state['turn_order'][0];
        $drawCount = count($state['players'][$firstPlayerId]['hand']) === 0 ? 5 : 2;
        $state['turn'] = [
            'active_player_id' => $firstPlayerId,
            'actions_left' => 3,
            'turn_number' => 1,
            'rent_multiplier' => 1,
            'cards_drawn' => $drawCount,
        ];

        // Active player draws cards at start of turn (5 if empty hand, else 2)
        self::drawCardsForPlayer($state, $firstPlayerId, $drawCount);

        $firstPlayerName = $state['players'][$firstPlayerId]['name'];
        self::addLog($state, "Game started! It's {$firstPlayerName}'s turn.");
    }

    public static function playCard(array &$state, string $playerId, string $cardId, string $targetType, array $params = []): void {
        if ($state['status'] !== 'playing') {
            throw new Exception("Game is not active.");
        }
        if (!empty($state['pending_payment']) || !empty($state['pending_action'])) {
            throw new Exception("Waiting for pending action or payment to be resolved.");
        }
        if ($state['turn']['active_player_id'] !== $playerId) {
            throw new Exception("Not your turn!");
        }
        if ($state['turn']['actions_left'] <= 0) {
            throw new Exception("No actions left this turn.");
        }

        $player = &$state['players'][$playerId];
        $cardIndex = -1;
        $card = null;

        foreach ($player['hand'] as $idx => $c) {
            if ($c['id'] === $cardId) {
                $cardIndex = $idx;
                $card = $c;
                break;
            }
        }

        if ($card === null) {
            throw new Exception("Card not found in your hand.");
        }

        // Remove card from hand
        array_splice($player['hand'], $cardIndex, 1);

        switch ($targetType) {
            case 'bank':
                if (in_array($card['type'], ['property', 'wild_property'], true)) {
                    throw new Exception("Property cards cannot be banked as money. They must be played to a property set.");
                }
                $player['bank'][] = $card;
                $valStr = '$' . $card['value'] . 'M';
                $extra = $card['type'] !== 'money' ? " ({$valStr})" : "";
                self::addLog($state, "{$player['name']} banked {$card['name']}{$extra}.");
                break;

            case 'property':
                if (!in_array($card['type'], ['property', 'wild_property'], true)) {
                    throw new Exception("This card cannot be played as a property.");
                }
                $color = $card['type'] === 'wild_property'
                    ? ($params['color'] ?? $card['current_color'] ?? $card['colors'][0])
                    : $card['group'];

                if (!isset(CardDefinitions::SET_RULES[$color])) {
                    throw new Exception("Invalid property color.");
                }

                if ($card['type'] === 'wild_property') {
                    if (!in_array($color, $card['colors'], true)) {
                        throw new Exception("Wildcard cannot be assigned to this color set.");
                    }
                    $card['current_color'] = $color;
                }

                if (!isset($player['property_sets'][$color])) {
                    $player['property_sets'][$color] = [];
                }
                $player['property_sets'][$color][] = $card;
                $colorName = CardDefinitions::SET_RULES[$color]['name'];
                self::addLog($state, "{$player['name']} played {$card['name']} to their {$colorName} set.");
                break;

            case 'action':
                // Action cards or Rent cards
                self::handleActionCard($state, $playerId, $card, $params);
                break;

            default:
                throw new Exception("Invalid target type.");
        }

        $state['turn']['actions_left']--;
        self::checkWinCondition($state);
        self::checkAutoEndTurn($state);
    }

    public static function moveProperty(array &$state, string $playerId, string $cardId, string $toColor): void {
        if ($state['status'] !== 'playing') {
            throw new Exception("Game is not active.");
        }
        if (!empty($state['pending_payment']) || !empty($state['pending_action'])) {
            throw new Exception("Waiting for pending action or payment to be resolved.");
        }
        if ($state['turn']['active_player_id'] !== $playerId) {
            throw new Exception("Not your turn!");
        }

        if (!isset(CardDefinitions::SET_RULES[$toColor])) {
            throw new Exception("Invalid target color.");
        }

        $player = &$state['players'][$playerId];
        $foundCard = null;
        $foundColor = null;
        $foundIdx = null;

        foreach ($player['property_sets'] as $color => $cards) {
            foreach ($cards as $idx => $c) {
                if ($c['id'] === $cardId) {
                    $foundCard = $c;
                    $foundColor = $color;
                    $foundIdx = $idx;
                    break 2;
                }
            }
        }

        if (!$foundCard) {
            throw new Exception("Card not found in your properties.");
        }

        if ($foundCard['type'] !== 'wild_property') {
            throw new Exception("Only wildcards can be moved to another color set.");
        }

        if (!in_array($toColor, $foundCard['colors'], true)) {
            throw new Exception("This wildcard cannot be assigned to " . CardDefinitions::SET_RULES[$toColor]['name'] . ".");
        }

        // Remove from source set
        array_splice($player['property_sets'][$foundColor], $foundIdx, 1);
        if (empty($player['property_sets'][$foundColor])) {
            unset($player['property_sets'][$foundColor]);
        }

        // Add to target set with new current_color
        $foundCard['current_color'] = $toColor;
        if (!isset($player['property_sets'][$toColor])) {
            $player['property_sets'][$toColor] = [];
        }
        $player['property_sets'][$toColor][] = $foundCard;

        $fromName = CardDefinitions::SET_RULES[$foundColor]['name'];
        $toName = CardDefinitions::SET_RULES[$toColor]['name'];
        self::addLog($state, "{$player['name']} moved wildcard from {$fromName} to {$toName} set.");

        self::checkWinCondition($state);
    }

    public static function endTurn(array &$state, string $playerId, array $discardCardIds = []): void {
        if ($state['status'] !== 'playing') {
            throw new Exception("Game is not active.");
        }
        if (!empty($state['pending_payment']) || !empty($state['pending_action'])) {
            throw new Exception("Waiting for pending action or payment to be resolved.");
        }
        if ($state['turn']['active_player_id'] !== $playerId) {
            throw new Exception("Not your turn!");
        }

        $player = &$state['players'][$playerId];

        self::handleExcessCards($state, $playerId);
        self::advanceToNextTurn($state, $playerId);
    }

    /**
     * When a player has more than 7 cards at the end of their turn,
     * randomly pick the excess cards and return them to the drawable cards (deck).
     * Records private notification info for this player.
     */
    public static function handleExcessCards(array &$state, string $playerId): void {
        if (!isset($state['players'][$playerId])) {
            return;
        }
        $player = &$state['players'][$playerId];
        $handCount = count($player['hand']);
        $excessCount = $handCount - 7;
        if ($excessCount <= 0) {
            return;
        }

        // Randomly pick $excessCount cards from the player's hand
        $keys = array_rand($player['hand'], $excessCount);
        if (!is_array($keys)) {
            $keys = [$keys];
        }

        $returnedCards = [];
        // Sort keys descending so array_splice does not shift following indices
        rsort($keys);
        foreach ($keys as $key) {
            $card = $player['hand'][$key];
            $returnedCards[] = $card;
            array_splice($player['hand'], $key, 1);
            // Return to drawable cards (deck)
            array_unshift($state['deck'], $card);
        }

        // Private notification data for the player (sanitizer will strip for opponents)
        $player['excess_cards_returned'] = [
            'count' => $excessCount,
            'initial_count' => $handCount,
            'cards' => $returnedCards,
            'timestamp' => microtime(true),
            'turn_number' => $state['turn']['turn_number'] ?? 1
        ];

        // Public activity log (does not reveal exact card identities)
        self::addLog($state, "⚠️ {$player['name']} had {$handCount} cards (exceeded 7 limit). {$excessCount} card(s) were randomly returned to the draw deck.");
    }

    public static function advanceToNextTurn(array &$state, string $playerId, string $customLogReason = ""): void {
        $player = &$state['players'][$playerId];
        $order = $state['turn_order'];
        $currentIndex = array_search($playerId, $order, true);
        if ($currentIndex === false) return;
        $nextIndex = ($currentIndex + 1) % count($order);
        $nextPlayerId = $order[$nextIndex];

        $state['turn']['active_player_id'] = $nextPlayerId;
        $state['turn']['actions_left'] = 3;
        $state['turn']['turn_number']++;
        $state['turn']['rent_multiplier'] = 1; // Reset multiplier for new turn

        $drawCount = count($state['players'][$nextPlayerId]['hand']) === 0 ? 5 : 2;
        self::drawCardsForPlayer($state, $nextPlayerId, $drawCount);
        $state['turn']['cards_drawn'] = $drawCount;

        $nextName = $state['players'][$nextPlayerId]['name'];
        $reason = $customLogReason ?: "{$player['name']} ended their turn.";
        if ($drawCount === 5) {
            self::addLog($state, "{$reason} Now it's {$nextName}'s turn. 🎴 {$nextName} ran out of cards and drew 5 cards!");
        } else {
            self::addLog($state, "{$reason} Now it's {$nextName}'s turn.");
        }
    }

    public static function checkAutoEndTurn(array &$state): void {
        if ($state['status'] !== 'playing' || !empty($state['pending_payment']) || !empty($state['pending_action'])) {
            return;
        }
        if (($state['turn']['actions_left'] ?? 3) > 0) {
            return;
        }
        $activeId = $state['turn']['active_player_id'] ?? null;
        if (!$activeId || !isset($state['players'][$activeId])) {
            return;
        }
        $activePlayer = $state['players'][$activeId];
        self::handleExcessCards($state, $activeId);
        self::advanceToNextTurn($state, $activeId, "{$activePlayer['name']} used all 3 actions.");
    }

    private static function handleActionCard(array &$state, string $playerId, array $card, array $params): void {
        $player = &$state['players'][$playerId];

        if ($card['type'] === 'action') {
            switch ($card['action']) {
                case 'pass_go':
                    self::drawCardsForPlayer($state, $playerId, 2);
                    $state['discard'][] = $card;
                    self::addLog($state, "{$player['name']} played Pass Go and drew 2 cards.");
                    return;

                case 'birthday':
                    $payers = [];
                    foreach ($state['players'] as $targetId => $target) {
                        if ($targetId === $playerId) continue;
                        $payers[$targetId] = [
                            'name' => $target['name'],
                            'amount_due' => 2,
                            'paid' => false,
                            'current_respondent_id' => $targetId,
                            'jsn_count' => 0,
                            'jsn_chain' => [],
                        ];
                    }
                    if (empty($payers)) {
                        $state['discard'][] = $card;
                        self::addLog($state, "{$player['name']} played It's My Birthday, but there are no opponents to pay.");
                        return;
                    }
                    $state['pending_payment'] = [
                        'collector_id' => $playerId,
                        'collector_name' => $player['name'],
                        'action_card' => $card,
                        'reason' => "It's My Birthday ($2M)",
                        'payers' => $payers,
                    ];
                    self::addLog($state, "🎂 {$player['name']} celebrated their Birthday! Demanded $2M from all opponents.");
                    return;

                case 'debt_collector':
                    $targetId = $params['target_player_id'] ?? null;
                    if (!$targetId || !isset($state['players'][$targetId]) || $targetId === $playerId) {
                        throw new Exception("Select a valid target player for Debt Collector.");
                    }
                    $target = $state['players'][$targetId];
                    $state['pending_payment'] = [
                        'collector_id' => $playerId,
                        'collector_name' => $player['name'],
                        'action_card' => $card,
                        'reason' => "Debt Collector ($5M)",
                        'payers' => [
                            $targetId => [
                                'name' => $target['name'],
                                'amount_due' => 5,
                                'paid' => false,
                                'current_respondent_id' => $targetId,
                                'jsn_count' => 0,
                                'jsn_chain' => [],
                            ]
                        ],
                    ];
                    self::addLog($state, "💰 {$player['name']} used Debt Collector on {$target['name']} demanding $5M!");
                    return;

                case 'double_rent':
                    $state['turn']['rent_multiplier'] = 2; // Strict 2x only
                    $state['discard'][] = $card;
                    self::addLog($state, "{$player['name']} played Double The Rent! Next rent will be doubled (2x).");
                    return;

                case 'house':
                    $color = $params['color'] ?? '';
                    if (!isset(CardDefinitions::SET_RULES[$color])) {
                        throw new Exception("Select a valid completed property set color for the House.");
                    }
                    if (in_array($color, ['railroad', 'utility'], true)) {
                        throw new Exception("Houses cannot be built on Railroads or Utilities.");
                    }
                    $set = $player['property_sets'][$color] ?? [];
                    if (!self::isCompleteSet($set, $color)) {
                        throw new Exception("You must complete the full set before adding a House.");
                    }
                    if (self::setHasHouse($set)) {
                        throw new Exception("This property set already has a House.");
                    }
                    $player['property_sets'][$color][] = $card;
                    $colorName = CardDefinitions::SET_RULES[$color]['name'];
                    self::addLog($state, "{$player['name']} added a House to their {$colorName} set (+ \$3M rent)!");
                    return;

                case 'hotel':
                    $color = $params['color'] ?? '';
                    if (!isset(CardDefinitions::SET_RULES[$color])) {
                        throw new Exception("Select a valid completed property set color for the Hotel.");
                    }
                    if (in_array($color, ['railroad', 'utility'], true)) {
                        throw new Exception("Hotels cannot be built on Railroads or Utilities.");
                    }
                    $set = $player['property_sets'][$color] ?? [];
                    if (!self::isCompleteSet($set, $color)) {
                        throw new Exception("You must complete the full set before adding a Hotel.");
                    }
                    if (!self::setHasHouse($set)) {
                        throw new Exception("You must have a House before adding a Hotel.");
                    }
                    if (self::setHasHotel($set)) {
                        throw new Exception("This property set already has a Hotel.");
                    }
                    $player['property_sets'][$color][] = $card;
                    $colorName = CardDefinitions::SET_RULES[$color]['name'];
                    self::addLog($state, "{$player['name']} added a Hotel to their {$colorName} set (+ \$4M rent)!");
                    return;

                case 'deal_breaker':
                    $targetId = $params['target_player_id'] ?? null;
                    $color = $params['color'] ?? '';
                    if (!$targetId || !isset($state['players'][$targetId]) || $targetId === $playerId) {
                        throw new Exception("Select a valid target player for Deal Breaker.");
                    }
                    $target = &$state['players'][$targetId];
                    $targetSet = $target['property_sets'][$color] ?? [];
                    if (!self::isCompleteSet($targetSet, $color)) {
                        throw new Exception("Deal Breaker can only steal a FULL, completed property set.");
                    }

                    $colorName = CardDefinitions::SET_RULES[$color]['name'] ?? $color;
                    $state['pending_action'] = [
                        'action' => 'deal_breaker',
                        'action_card' => $card,
                        'initiator_id' => $playerId,
                        'initiator_name' => $player['name'],
                        'target_id' => $targetId,
                        'target_name' => $target['name'],
                        'params' => [
                            'color' => $color,
                            'color_name' => $colorName,
                        ],
                        'reason' => "Deal Breaker (stealing full {$colorName} set)",
                        'current_respondent_id' => $targetId,
                        'current_respondent_name' => $target['name'],
                        'jsn_count' => 0,
                        'jsn_chain' => [],
                    ];
                    self::addLog($state, "🚨 {$player['name']} played Deal Breaker on {$target['name']} targeting their full {$colorName} set!");
                    return;

                case 'sly_deal':
                    $targetId = $params['target_player_id'] ?? null;
                    $stolenCardId = $params['card_id'] ?? '';
                    if (!$targetId || !isset($state['players'][$targetId]) || $targetId === $playerId) {
                        throw new Exception("Select a valid target player for Sly Deal.");
                    }
                    $target = &$state['players'][$targetId];
                    $foundCol = null;
                    $foundIdx = null;
                    $stolenCard = null;

                    foreach ($target['property_sets'] as $col => $cards) {
                        foreach ($cards as $idx => $c) {
                            if ($c['id'] === $stolenCardId) {
                                $foundCol = $col;
                                $foundIdx = $idx;
                                $stolenCard = $c;
                                break 2;
                            }
                        }
                    }

                    if (!$stolenCard) {
                        throw new Exception("Target property card not found.");
                    }

                    if (self::isCompleteSet($target['property_sets'][$foundCol], $foundCol)) {
                        throw new Exception("Cannot steal a property from a completed set with Sly Deal!");
                    }

                    $isStandardProp = ($stolenCard['type'] === 'property');
                    $isDualWild = ($stolenCard['type'] === 'wild_property' && count($stolenCard['colors'] ?? []) === 2);

                    if (!$isStandardProp && !$isDualWild) {
                        throw new Exception("Sly Deal can only steal standard properties or dual-color properties from incomplete sets (multi-color wildcards cannot be stolen).");
                    }

                    $destCol = $stolenCard['type'] === 'wild_property'
                        ? ($params['color'] ?? $stolenCard['current_color'] ?? $stolenCard['colors'][0])
                        : $foundCol;

                    $state['pending_action'] = [
                        'action' => 'sly_deal',
                        'action_card' => $card,
                        'initiator_id' => $playerId,
                        'initiator_name' => $player['name'],
                        'target_id' => $targetId,
                        'target_name' => $target['name'],
                        'params' => [
                            'card_id' => $stolenCardId,
                            'dest_color' => $destCol,
                            'found_color' => $foundCol,
                            'card_name' => $stolenCard['name'],
                        ],
                        'reason' => "Sly Deal (stealing {$stolenCard['name']})",
                        'current_respondent_id' => $targetId,
                        'current_respondent_name' => $target['name'],
                        'jsn_count' => 0,
                        'jsn_chain' => [],
                    ];
                    self::addLog($state, "🕵️ {$player['name']} played Sly Deal on {$target['name']} targeting {$stolenCard['name']}!");
                    return;

                case 'forced_deal':
                    $targetId = $params['target_player_id'] ?? null;
                    $myCardId = $params['my_card_id'] ?? '';
                    $targetCardId = $params['target_card_id'] ?? '';

                    if (!$targetId || !isset($state['players'][$targetId]) || $targetId === $playerId) {
                        throw new Exception("Select a valid target player for Forced Deal.");
                    }
                    $target = &$state['players'][$targetId];

                    // Find my card
                    $myCol = null; $myIdx = null; $myCard = null;
                    foreach ($player['property_sets'] as $col => $cards) {
                        foreach ($cards as $idx => $c) {
                            if ($c['id'] === $myCardId) {
                                $myCol = $col; $myIdx = $idx; $myCard = $c;
                                break 2;
                            }
                        }
                    }
                    if (!$myCard || !in_array($myCard['type'], ['property', 'wild_property'], true)) {
                        throw new Exception("Invalid card selected to give up.");
                    }
                    if (self::isCompleteSet($player['property_sets'][$myCol], $myCol)) {
                        throw new Exception("Cannot give away a card from your own completed set.");
                    }

                    // Find target card
                    $targetCol = null; $targetIdx = null; $targetCard = null;
                    foreach ($target['property_sets'] as $col => $cards) {
                        foreach ($cards as $idx => $c) {
                            if ($c['id'] === $targetCardId) {
                                $targetCol = $col; $targetIdx = $idx; $targetCard = $c;
                                break 2;
                            }
                        }
                    }
                    if (!$targetCard || !in_array($targetCard['type'], ['property', 'wild_property'], true)) {
                        throw new Exception("Invalid target card selected to steal.");
                    }
                    if (self::isCompleteSet($target['property_sets'][$targetCol], $targetCol)) {
                        throw new Exception("Cannot steal a property from a completed set with Forced Deal!");
                    }

                    $isTargetStandardProp = ($targetCard['type'] === 'property');
                    $isTargetDualWild = ($targetCard['type'] === 'wild_property' && count($targetCard['colors'] ?? []) === 2);

                    if (!$isTargetStandardProp && !$isTargetDualWild) {
                        throw new Exception("Forced Deal can only target standard properties or dual-color properties from incomplete sets (multi-color wildcards cannot be swapped).");
                    }

                    $pDestCol = $targetCard['type'] === 'wild_property' ? ($params['my_dest_color'] ?? $targetCard['current_color'] ?? $targetCol) : $targetCol;
                    $tDestCol = $myCard['type'] === 'wild_property' ? ($myCard['current_color'] ?? $myCol) : $myCol;

                    $state['pending_action'] = [
                        'action' => 'forced_deal',
                        'action_card' => $card,
                        'initiator_id' => $playerId,
                        'initiator_name' => $player['name'],
                        'target_id' => $targetId,
                        'target_name' => $target['name'],
                        'params' => [
                            'my_card_id' => $myCardId,
                            'target_card_id' => $targetCardId,
                            'p_dest_color' => $pDestCol,
                            't_dest_color' => $tDestCol,
                            'my_card_name' => $myCard['name'],
                            'target_card_name' => $targetCard['name'],
                        ],
                        'reason' => "Forced Deal (swapping {$myCard['name']} for {$targetCard['name']})",
                        'current_respondent_id' => $targetId,
                        'current_respondent_name' => $target['name'],
                        'jsn_count' => 0,
                        'jsn_chain' => [],
                    ];
                    self::addLog($state, "🔄 {$player['name']} played Forced Deal on {$target['name']}, offering {$myCard['name']} for {$targetCard['name']}!");
                    return;

                case 'just_say_no':
                    $state['discard'][] = $card;
                    self::addLog($state, "{$player['name']} played Just Say No.");
                    return;

                default:
                    $state['discard'][] = $card;
                    self::addLog($state, "{$player['name']} played {$card['name']}.");
                    return;
            }
        }

        // Rent cards (rent and rent_wild)
        if (in_array($card['type'], ['rent', 'rent_wild'], true)) {
            $isWild = $card['type'] === 'rent_wild';
            $color = $params['color'] ?? $card['colors'][0];

            if (!isset(CardDefinitions::SET_RULES[$color])) {
                throw new Exception("Invalid color selected for Rent.");
            }
            if (!$isWild && !in_array($color, $card['colors'], true)) {
                throw new Exception("This rent card cannot be applied to the selected color.");
            }

            $baseRent = self::calculateRent($player, $color);
            if ($baseRent <= 0) {
                throw new Exception("You have no properties in the selected color to charge rent for!");
            }

            $multiplier = min(2, max(1, (int)($state['turn']['rent_multiplier'] ?? 1)));
            $rentValue = $baseRent * $multiplier;
            $state['turn']['rent_multiplier'] = 1; // Consume multiplier

            $colorName = CardDefinitions::SET_RULES[$color]['name'];
            $multText = $multiplier > 1 ? " (2x Double Rent applied: \${$baseRent}M x 2 = \${$rentValue}M)" : "";

            if ($isWild) {
                // Wild Rent targets ONLY 1 player
                $targetId = $params['target_player_id'] ?? null;
                if (!$targetId || !isset($state['players'][$targetId]) || $targetId === $playerId) {
                    throw new Exception("Select a valid target player for Wild Rent.");
                }
                $target = $state['players'][$targetId];
                $state['pending_payment'] = [
                    'collector_id' => $playerId,
                    'collector_name' => $player['name'],
                    'action_card' => $card,
                    'reason' => "Wild Rent ({$colorName}) - \${$rentValue}M{$multText}",
                    'payers' => [
                        $targetId => [
                            'name' => $target['name'],
                            'amount_due' => $rentValue,
                            'paid' => false,
                            'current_respondent_id' => $targetId,
                            'jsn_count' => 0,
                            'jsn_chain' => [],
                        ]
                    ],
                ];
                self::addLog($state, "💰 {$player['name']} charged {$target['name']} \${$rentValue}M wild rent for {$colorName}{$multText}.");
            } else {
                // Standard Rent targets ALL opponents
                $payers = [];
                foreach ($state['players'] as $targetId => $target) {
                    if ($targetId === $playerId) continue;
                    $payers[$targetId] = [
                        'name' => $target['name'],
                        'amount_due' => $rentValue,
                        'paid' => false,
                        'current_respondent_id' => $targetId,
                        'jsn_count' => 0,
                        'jsn_chain' => [],
                    ];
                }
                if (empty($payers)) {
                    $state['discard'][] = $card;
                    self::addLog($state, "{$player['name']} charged rent, but there are no opponents to pay.");
                    return;
                }
                $state['pending_payment'] = [
                    'collector_id' => $playerId,
                    'collector_name' => $player['name'],
                    'action_card' => $card,
                    'reason' => "Rent ({$colorName}) - \${$rentValue}M{$multText}",
                    'payers' => $payers,
                ];
                self::addLog($state, "💰 {$player['name']} charged all opponents \${$rentValue}M rent for {$colorName}{$multText}.");
            }
            return;
        }

        $state['discard'][] = $card;
    }

    public static function getSetPropertiesCount(array $cards): int {
        $count = 0;
        foreach ($cards as $c) {
            if (in_array($c['type'] ?? '', ['property', 'wild_property'], true)) {
                $count++;
            }
        }
        return $count;
    }

    public static function isCompleteSet(array $cards, string $color): bool {
        if (!isset(CardDefinitions::SET_RULES[$color])) return false;
        return self::getSetPropertiesCount($cards) >= CardDefinitions::SET_RULES[$color]['size'];
    }

    public static function setHasHouse(array $cards): bool {
        foreach ($cards as $c) {
            if (($c['action'] ?? '') === 'house') return true;
        }
        return false;
    }

    public static function setHasHotel(array $cards): bool {
        foreach ($cards as $c) {
            if (($c['action'] ?? '') === 'hotel') return true;
        }
        return false;
    }

    public static function calculateRent(array $player, string $color): int {
        $cards = $player['property_sets'][$color] ?? [];
        if (empty($cards)) return 0;

        $rule = CardDefinitions::SET_RULES[$color] ?? null;
        if (!$rule) return 0;

        $propCount = self::getSetPropertiesCount($cards);
        if ($propCount === 0) return 0;

        $rentIndex = min($propCount - 1, count($rule['rent']) - 1);
        $rent = $rule['rent'][$rentIndex];

        // If complete set, add House and Hotel bonuses
        if ($propCount >= $rule['size']) {
            if (self::setHasHouse($cards)) $rent += 3;
            if (self::setHasHotel($cards)) $rent += 4;
        }

        return $rent;
    }

    /**
     * Determines property set value based on set rules (rent scale) and attached buildings.
     */
    public static function getPropertySetValue(string $color, int $propCount, bool $hasHouse = false, bool $hasHotel = false): int {
        if ($propCount <= 0) return 0;
        $rule = CardDefinitions::SET_RULES[$color] ?? null;
        if (!$rule) return 0;
        $rentIndex = min($propCount - 1, count($rule['rent']) - 1);
        $val = $rule['rent'][$rentIndex];
        if ($propCount >= $rule['size']) {
            if ($hasHouse) $val += 3;
            if ($hasHotel) $val += 4;
        }
        return $val;
    }

    /**
     * Calculates a player's total table asset value using set-level valuation for properties.
     */
    public static function calculatePlayerTableValue(array $player): int {
        $total = 0;
        foreach ($player['bank'] as $bCard) {
            $total += (int)($bCard['value'] ?? 0);
        }
        foreach ($player['property_sets'] as $color => $pCards) {
            $pCount = self::getSetPropertiesCount($pCards);
            $hasHouse = self::setHasHouse($pCards);
            $hasHotel = self::setHasHotel($pCards);
            $total += self::getPropertySetValue($color, $pCount, $hasHouse, $hasHotel);
        }
        return $total;
    }

    /**
     * Resolves payment from a payer choosing cards from their bank and/or properties.
     */
    public static function resolvePayment(array &$state, string $playerId, array $cardIds): void {
        if ($state['status'] !== 'playing') {
            throw new Exception("Game is not active.");
        }
        if (empty($state['pending_payment'])) {
            throw new Exception("No pending payment to resolve.");
        }
        $pending = &$state['pending_payment'];
        if (!isset($pending['payers'][$playerId])) {
            throw new Exception("You do not owe any payment.");
        }
        if ($pending['payers'][$playerId]['paid']) {
            throw new Exception("You have already paid.");
        }

        $payer = &$state['players'][$playerId];
        $collectorId = $pending['collector_id'];
        if (!isset($state['players'][$collectorId])) {
            // Collector left, cancel pending payment
            $state['discard'][] = $pending['action_card'];
            $state['pending_payment'] = null;
            return;
        }
        $collector = &$state['players'][$collectorId];
        $amountDue = (int)$pending['payers'][$playerId]['amount_due'];

        // Gather all cards on payer's table (bank + properties)
        $allTableCards = [];
        foreach ($payer['bank'] as $bCard) {
            $allTableCards[$bCard['id']] = ['location' => 'bank', 'card' => $bCard];
        }
        foreach ($payer['property_sets'] as $color => $pCards) {
            foreach ($pCards as $pCard) {
                $allTableCards[$pCard['id']] = ['location' => 'property', 'color' => $color, 'card' => $pCard];
            }
        }

        $totalTableValue = self::calculatePlayerTableValue($payer);

        // Validate selected cards
        $selectedCards = [];
        $seen = [];
        foreach ($cardIds as $cid) {
            if (isset($seen[$cid])) {
                throw new Exception("Duplicate card in payment selection.");
            }
            $seen[$cid] = true;
            if (!isset($allTableCards[$cid])) {
                throw new Exception("Card {$cid} is not on your table.");
            }
            $info = $allTableCards[$cid];
            $selectedCards[] = $info;
        }

        // Calculate selected value with set-level property valuation
        $selectedBankTotal = 0;
        $selectedPropsByColor = [];
        foreach ($selectedCards as $info) {
            if ($info['location'] === 'bank') {
                $selectedBankTotal += (int)($info['card']['value'] ?? 0);
            } elseif ($info['location'] === 'property') {
                $col = $info['color'];
                if (!isset($selectedPropsByColor[$col])) {
                    $selectedPropsByColor[$col] = ['count' => 0, 'has_house' => false, 'has_hotel' => false];
                }
                $c = $info['card'];
                if (in_array($c['type'] ?? '', ['property', 'wild_property'], true)) {
                    $selectedPropsByColor[$col]['count']++;
                } elseif (($c['action'] ?? '') === 'house') {
                    $selectedPropsByColor[$col]['has_house'] = true;
                } elseif (($c['action'] ?? '') === 'hotel') {
                    $selectedPropsByColor[$col]['has_hotel'] = true;
                }
            }
        }
        $selectedPropTotal = 0;
        foreach ($selectedPropsByColor as $col => $data) {
            $selectedPropTotal += self::getPropertySetValue($col, $data['count'], $data['has_house'], $data['has_hotel']);
        }
        $selectedTotal = $selectedBankTotal + $selectedPropTotal;

        // Rule verification
        if ($totalTableValue === 0) {
            if (!empty($cardIds)) {
                throw new Exception("You have no assets on your table to pay with.");
            }
        } elseif ($totalTableValue <= $amountDue) {
            // Cannot cover full amount, must pay everything on table
            if (count($selectedCards) !== count($allTableCards)) {
                throw new Exception("You cannot afford the full \${$amountDue}M. You must surrender all cards on your table (\${$totalTableValue}M).");
            }
        } else {
            // Can cover full amount, selected cards must equal or exceed amount due
            if ($selectedTotal < $amountDue) {
                throw new Exception("Selected cards total \${$selectedTotal}M, but you owe \${$amountDue}M.");
            }
        }

        // Transfer cards from payer to collector
        $cardNames = [];
        foreach ($selectedCards as $info) {
            $c = $info['card'];
            $cardNames[] = $c['name'];
            if ($info['location'] === 'bank') {
                // Remove from payer bank
                $payer['bank'] = array_values(array_filter($payer['bank'], fn($bc) => $bc['id'] !== $c['id']));
                // Add to collector bank
                $collector['bank'][] = $c;
            } elseif ($info['location'] === 'property') {
                $col = $info['color'];
                // Remove from payer property set
                $payer['property_sets'][$col] = array_values(array_filter(
                    $payer['property_sets'][$col] ?? [],
                    fn($pc) => $pc['id'] !== $c['id']
                ));
                if (empty($payer['property_sets'][$col])) {
                    unset($payer['property_sets'][$col]);
                }

                // Transfer to collector
                if (in_array($c['type'] ?? '', ['property', 'wild_property'], true)) {
                    $targetColor = $c['type'] === 'wild_property'
                        ? ($c['current_color'] ?? $c['colors'][0] ?? $col)
                        : ($c['group'] ?? $col);
                    if (!isset($collector['property_sets'][$targetColor])) {
                        $collector['property_sets'][$targetColor] = [];
                    }
                    $collector['property_sets'][$targetColor][] = $c;
                } else {
                    // House or hotel goes to collector bank as money value
                    $collector['bank'][] = $c;
                }
            }
        }

        // Check for broken sets on payer with houses/hotels
        foreach ($payer['property_sets'] as $col => &$setCards) {
            if (!self::isCompleteSet($setCards, $col)) {
                $retained = [];
                foreach ($setCards as $sc) {
                    if (in_array($sc['action'] ?? '', ['house', 'hotel'], true)) {
                        $payer['bank'][] = $sc;
                    } else {
                        $retained[] = $sc;
                    }
                }
                $setCards = $retained;
            }
        }
        unset($setCards);
        foreach ($payer['property_sets'] as $col => $sc) {
            if (empty($sc)) unset($payer['property_sets'][$col]);
        }

        if (empty($cardNames)) {
            self::addLog($state, "⚪ {$payer['name']} had no assets on table and paid \$0.");
        } else {
            $paidList = implode(', ', $cardNames);
            self::addLog($state, "💵 {$payer['name']} paid \${$selectedTotal}M ({$paidList}) to {$collector['name']}.");
        }

        $pending['payers'][$playerId]['paid'] = true;

        // Check if all payers have completed payment
        $allDone = true;
        foreach ($pending['payers'] as $pInfo) {
            if (!$pInfo['paid']) {
                $allDone = false;
                break;
            }
        }

        if ($allDone) {
            foreach ($pending['payers'] as $pInfo) {
                foreach ($pInfo['jsn_chain'] ?? [] as $jsn) {
                    $state['discard'][] = $jsn['card'];
                }
            }
            $state['discard'][] = $pending['action_card'];
            $state['pending_payment'] = null;
        }

        self::checkWinCondition($state);
        self::checkAutoEndTurn($state);
    }

    /**
     * Executes a pending property action (deal_breaker, sly_deal, forced_deal) when accepted.
     */
    public static function executePendingAction(array &$state): void {
        if (empty($state['pending_action'])) return;
        $pending = $state['pending_action'];
        $initiator = &$state['players'][$pending['initiator_id']];
        $target = &$state['players'][$pending['target_id']];
        $params = $pending['params'];

        // Discard all Just Say No cards played in chain
        foreach ($pending['jsn_chain'] ?? [] as $jsn) {
            $state['discard'][] = $jsn['card'];
        }

        switch ($pending['action']) {
            case 'deal_breaker':
                $color = $params['color'];
                $targetSet = $target['property_sets'][$color] ?? [];
                if (!empty($targetSet)) {
                    if (!isset($initiator['property_sets'][$color])) {
                        $initiator['property_sets'][$color] = [];
                    }
                    foreach ($targetSet as $stolenCard) {
                        $initiator['property_sets'][$color][] = $stolenCard;
                    }
                    unset($target['property_sets'][$color]);
                    $colorName = CardDefinitions::SET_RULES[$color]['name'] ?? $color;
                    self::addLog($state, "🚨 {$initiator['name']} successfully stole {$target['name']}'s full {$colorName} set with Deal Breaker!");
                }
                break;

            case 'sly_deal':
                $stolenCardId = $params['card_id'];
                $destCol = $params['dest_color'];
                $foundCol = null;
                $foundIdx = null;
                $stolenCard = null;

                foreach ($target['property_sets'] as $col => $cards) {
                    foreach ($cards as $idx => $c) {
                        if ($c['id'] === $stolenCardId) {
                            $foundCol = $col;
                            $foundIdx = $idx;
                            $stolenCard = $c;
                            break 2;
                        }
                    }
                }

                if ($stolenCard) {
                    array_splice($target['property_sets'][$foundCol], $foundIdx, 1);
                    if (empty($target['property_sets'][$foundCol])) {
                        unset($target['property_sets'][$foundCol]);
                    }
                    if ($stolenCard['type'] === 'wild_property') {
                        $stolenCard['current_color'] = $destCol;
                    }
                    if (!isset($initiator['property_sets'][$destCol])) {
                        $initiator['property_sets'][$destCol] = [];
                    }
                    $initiator['property_sets'][$destCol][] = $stolenCard;
                    self::addLog($state, "🕵️ {$initiator['name']} successfully stole {$stolenCard['name']} from {$target['name']} with Sly Deal!");
                }
                break;

            case 'forced_deal':
                $myCardId = $params['my_card_id'];
                $targetCardId = $params['target_card_id'];
                $pDestCol = $params['p_dest_color'];
                $tDestCol = $params['t_dest_color'];

                $myCol = null; $myIdx = null; $myCard = null;
                foreach ($initiator['property_sets'] as $col => $cards) {
                    foreach ($cards as $idx => $c) {
                        if ($c['id'] === $myCardId) {
                            $myCol = $col; $myIdx = $idx; $myCard = $c;
                            break 2;
                        }
                    }
                }

                $targetCol = null; $targetIdx = null; $targetCard = null;
                foreach ($target['property_sets'] as $col => $cards) {
                    foreach ($cards as $idx => $c) {
                        if ($c['id'] === $targetCardId) {
                            $targetCol = $col; $targetIdx = $idx; $targetCard = $c;
                            break 2;
                        }
                    }
                }

                if ($myCard && $targetCard) {
                    array_splice($initiator['property_sets'][$myCol], $myIdx, 1);
                    if (empty($initiator['property_sets'][$myCol])) unset($initiator['property_sets'][$myCol]);

                    array_splice($target['property_sets'][$targetCol], $targetIdx, 1);
                    if (empty($target['property_sets'][$targetCol])) unset($target['property_sets'][$targetCol]);

                    if ($targetCard['type'] === 'wild_property') $targetCard['current_color'] = $pDestCol;
                    if (!isset($initiator['property_sets'][$pDestCol])) $initiator['property_sets'][$pDestCol] = [];
                    $initiator['property_sets'][$pDestCol][] = $targetCard;

                    if ($myCard['type'] === 'wild_property') $myCard['current_color'] = $tDestCol;
                    if (!isset($target['property_sets'][$tDestCol])) $target['property_sets'][$tDestCol] = [];
                    $target['property_sets'][$tDestCol][] = $myCard;

                    self::addLog($state, "🔄 {$initiator['name']} completed Forced Deal with {$target['name']}, swapping {$myCard['name']} for {$targetCard['name']}!");
                }
                break;
        }

        $state['discard'][] = $pending['action_card'];
        $state['pending_action'] = null;
        self::checkWinCondition($state);
        self::checkAutoEndTurn($state);
    }

    /**
     * Resolves accepting an action or accepting a Just Say No.
     */
    public static function resolveAcceptAction(array &$state, string $playerId): void {
        if ($state['status'] !== 'playing') {
            throw new Exception("Game is not active.");
        }

        // 1. Pending Property Action
        if (!empty($state['pending_action'])) {
            $pending = &$state['pending_action'];
            if (($pending['current_respondent_id'] ?? '') !== $playerId) {
                throw new Exception("It is not your turn to respond.");
            }

            if ($playerId === $pending['initiator_id']) {
                // Initiator accepts the opponent's Just Say No -> action cancelled!
                foreach ($pending['jsn_chain'] ?? [] as $jsn) {
                    $state['discard'][] = $jsn['card'];
                }
                $state['discard'][] = $pending['action_card'];
                self::addLog($state, "🛑 {$pending['initiator_name']} accepted {$pending['target_name']}'s Just Say No. {$pending['action_card']['name']} was blocked.");
                $state['pending_action'] = null;
                self::checkAutoEndTurn($state);
                return;
            }

            if ($playerId === $pending['target_id']) {
                // Target player accepts the action -> execute theft/swap!
                self::executePendingAction($state);
                return;
            }
        }

        // 2. Pending Payment Action (Collector accepts payer's Just Say No)
        if (!empty($state['pending_payment'])) {
            $pending = &$state['pending_payment'];
            if ($playerId !== $pending['collector_id']) {
                throw new Exception("Only the collector can accept a Just Say No on pending payment.");
            }

            $targetPayerId = null;
            foreach ($pending['payers'] as $pid => $pInfo) {
                if (!$pInfo['paid'] && ($pInfo['current_respondent_id'] ?? '') === $playerId) {
                    $targetPayerId = $pid;
                    break;
                }
            }

            if (!$targetPayerId) {
                throw new Exception("No active Just Say No to accept.");
            }

            $payerInfo = &$pending['payers'][$targetPayerId];
            foreach ($payerInfo['jsn_chain'] ?? [] as $jsn) {
                $state['discard'][] = $jsn['card'];
            }
            $payerInfo['paid'] = true;
            self::addLog($state, "🛑 {$pending['collector_name']} accepted {$payerInfo['name']}'s Just Say No. {$payerInfo['name']} owes \$0.");

            $allDone = true;
            foreach ($pending['payers'] as $pInfo) {
                if (!$pInfo['paid']) {
                    $allDone = false;
                    break;
                }
            }
            if ($allDone) {
                $state['discard'][] = $pending['action_card'];
                $state['pending_payment'] = null;
            }
            self::checkAutoEndTurn($state);
            return;
        }

        throw new Exception("No pending action to accept.");
    }

    /**
     * Resolves Just Say No (including counter Just Say No) by defender or attacker.
     */
    public static function resolveJustSayNo(array &$state, string $playerId): void {
        if ($state['status'] !== 'playing') {
            throw new Exception("Game is not active.");
        }

        if (empty($state['pending_payment']) && empty($state['pending_action'])) {
            throw new Exception("No pending action or payment to respond to with Just Say No.");
        }

        $player = &$state['players'][$playerId];

        // Check if player has Just Say No in hand
        $jsnIndex = -1;
        $jsnCard = null;
        foreach ($player['hand'] as $idx => $c) {
            if (($c['action'] ?? '') === 'just_say_no') {
                $jsnIndex = $idx;
                $jsnCard = $c;
                break;
            }
        }

        if (!$jsnCard) {
            throw new Exception("You do not have a Just Say No card in your hand.");
        }

        // 1. Pending Property Action (deal_breaker, sly_deal, forced_deal)
        if (!empty($state['pending_action'])) {
            $pending = &$state['pending_action'];
            if (($pending['current_respondent_id'] ?? '') !== $playerId) {
                throw new Exception("It is not your turn to play Just Say No.");
            }

            // Remove card from hand and add to chain
            array_splice($player['hand'], $jsnIndex, 1);
            if (!isset($pending['jsn_chain'])) $pending['jsn_chain'] = [];
            $pending['jsn_chain'][] = [
                'player_id' => $playerId,
                'player_name' => $player['name'],
                'card' => $jsnCard
            ];
            $pending['jsn_count'] = ($pending['jsn_count'] ?? 0) + 1;

            if ($playerId === $pending['target_id']) {
                // Defender played JSN -> now attacker must respond
                $pending['current_respondent_id'] = $pending['initiator_id'];
                $pending['current_respondent_name'] = $pending['initiator_name'];
                if ($pending['jsn_count'] === 1) {
                    self::addLog($state, "🛑 {$player['name']} played JUST SAY NO against {$pending['initiator_name']}'s {$pending['action_card']['name']}!");
                } else {
                    self::addLog($state, "🛑 {$player['name']} countered {$pending['initiator_name']} with JUST SAY NO!");
                }
            } else {
                // Attacker countered with JSN -> now defender must respond
                $pending['current_respondent_id'] = $pending['target_id'];
                $pending['current_respondent_name'] = $pending['target_name'];
                self::addLog($state, "🛑 {$player['name']} countered {$pending['target_name']} with JUST SAY NO!");
            }
            return;
        }

        // 2. Pending Payment Action (rent, birthday, debt_collector)
        if (!empty($state['pending_payment'])) {
            $pending = &$state['pending_payment'];

            if (isset($pending['payers'][$playerId])) {
                // Player is a payer responding
                $payerInfo = &$pending['payers'][$playerId];
                if ($payerInfo['paid']) {
                    throw new Exception("You have already resolved your payment.");
                }
                if (($payerInfo['current_respondent_id'] ?? $playerId) !== $playerId) {
                    throw new Exception("It is not your turn to play Just Say No.");
                }

                array_splice($player['hand'], $jsnIndex, 1);
                if (!isset($payerInfo['jsn_chain'])) $payerInfo['jsn_chain'] = [];
                $payerInfo['jsn_chain'][] = [
                    'player_id' => $playerId,
                    'player_name' => $player['name'],
                    'card' => $jsnCard
                ];
                $payerInfo['jsn_count'] = ($payerInfo['jsn_count'] ?? 0) + 1;
                $payerInfo['current_respondent_id'] = $pending['collector_id'];

                if ($payerInfo['jsn_count'] === 1) {
                    self::addLog($state, "🛑 {$player['name']} played JUST SAY NO against {$pending['collector_name']}!");
                } else {
                    self::addLog($state, "🛑 {$player['name']} countered {$pending['collector_name']} with JUST SAY NO!");
                }
                return;
            } elseif ($playerId === $pending['collector_id']) {
                // Player is collector countering a payer
                $targetPayerId = null;
                foreach ($pending['payers'] as $pid => $pInfo) {
                    if (!$pInfo['paid'] && ($pInfo['current_respondent_id'] ?? '') === $playerId) {
                        $targetPayerId = $pid;
                        break;
                    }
                }
                if (!$targetPayerId) {
                    throw new Exception("No active Just Say No to counter.");
                }

                $payerInfo = &$pending['payers'][$targetPayerId];
                array_splice($player['hand'], $jsnIndex, 1);
                if (!isset($payerInfo['jsn_chain'])) $payerInfo['jsn_chain'] = [];
                $payerInfo['jsn_chain'][] = [
                    'player_id' => $playerId,
                    'player_name' => $player['name'],
                    'card' => $jsnCard
                ];
                $payerInfo['jsn_count'] = ($payerInfo['jsn_count'] ?? 0) + 1;
                $payerInfo['current_respondent_id'] = $targetPayerId;

                self::addLog($state, "🛑 {$player['name']} countered {$payerInfo['name']} with JUST SAY NO!");
                return;
            }

            throw new Exception("You do not owe payment or have a counter to respond to.");
        }
    }

    public static function drawCardsForPlayer(array &$state, string $playerId, int $count): void {
        $player = &$state['players'][$playerId];
        for ($i = 0; $i < $count; $i++) {
            if (empty($state['deck'])) {
                if (empty($state['discard'])) {
                    break;
                }
                $state['deck'] = $state['discard'];
                $state['discard'] = [];
                shuffle($state['deck']);
            }
            $player['hand'][] = array_shift($state['deck']);
        }
    }

    public static function checkWinCondition(array &$state): void {
        foreach ($state['players'] as $pid => $player) {
            $completedCount = 0;
            foreach ($player['property_sets'] as $color => $cards) {
                if (self::isCompleteSet($cards, $color)) {
                    $completedCount++;
                }
            }
            if ($completedCount >= 3) {
                $state['status'] = 'finished';
                $state['winner_id'] = $pid;
                self::addLog($state, "🎉 {$player['name']} has completed 3 full property sets and WON THE GAME!");
                break;
            }
        }
    }

    private static function addLog(array &$state, string $text): void {
        $state['logs'][] = [
            'time' => time(),
            'text' => $text,
        ];
        if (count($state['logs']) > 30) {
            array_shift($state['logs']);
        }
    }

    /**
     * Strips secret opponent info (hands) and card deck order before sending to client.
     */
    public static function sanitizeStateForPlayer(array $state, string $playerId): array {
        $clean = $state;
        $clean['deck_count'] = count($state['deck']);
        unset($clean['deck']);

        foreach ($clean['players'] as $pid => &$p) {
            if ($pid !== $playerId) {
                $p['hand_count'] = count($p['hand']);
                unset($p['hand']);
                if (isset($p['excess_cards_returned'])) {
                    unset($p['excess_cards_returned']);
                }
            }
        }
        unset($p);

        $clean['my_player_id'] = $playerId;
        return $clean;
    }
}
