<?php
declare(strict_types=1);

require_once __DIR__ . '/cards.php';

class GameEngine {
    public static function createGame(string $hostName): array {
        $hostId = 'p_' . bin2hex(random_bytes(4));
        return [
            'status' => 'lobby', // 'lobby' | 'playing' | 'finished'
            'deck' => CardDefinitions::createDeck(),
            'discard' => [],
            'players' => [
                $hostId => [
                    'id' => $hostId,
                    'name' => trim($hostName) ?: 'Host',
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
            'logs' => [
                ['time' => time(), 'text' => "Game lobby created by " . htmlspecialchars($hostName)]
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

        $playerId = 'p_' . bin2hex(random_bytes(4));
        $name = trim($playerName) ?: ('Player ' . (count($state['players']) + 1));

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
        $state['turn'] = [
            'active_player_id' => $firstPlayerId,
            'actions_left' => 3,
            'turn_number' => 1,
            'rent_multiplier' => 1,
        ];

        // Active player draws 2 cards at start of turn
        self::drawCardsForPlayer($state, $firstPlayerId, 2);

        $firstPlayerName = $state['players'][$firstPlayerId]['name'];
        self::addLog($state, "Game started! It's {$firstPlayerName}'s turn.");
    }

    public static function playCard(array &$state, string $playerId, string $cardId, string $targetType, array $params = []): void {
        if ($state['status'] !== 'playing') {
            throw new Exception("Game is not active.");
        }
        if (!empty($state['pending_payment'])) {
            throw new Exception("Waiting for pending payment(s) to be resolved.");
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
                // Any money, action, or rent card can be banked
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
        if (!empty($state['pending_payment'])) {
            throw new Exception("Waiting for pending payment(s) to be resolved.");
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
        if (!empty($state['pending_payment'])) {
            throw new Exception("Waiting for pending payment(s) to be resolved.");
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

        $nextName = $state['players'][$nextPlayerId]['name'];
        $reason = $customLogReason ?: "{$player['name']} ended their turn.";
        self::addLog($state, "{$reason} Now it's {$nextName}'s turn.");
    }

    public static function checkAutoEndTurn(array &$state): void {
        if ($state['status'] !== 'playing' || !empty($state['pending_payment'])) {
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
                            ]
                        ],
                    ];
                    self::addLog($state, "💰 {$player['name']} used Debt Collector on {$target['name']} demanding $5M!");
                    return;

                case 'double_rent':
                    $state['turn']['rent_multiplier'] = ($state['turn']['rent_multiplier'] ?? 1) * 2;
                    $state['discard'][] = $card;
                    $mult = $state['turn']['rent_multiplier'];
                    self::addLog($state, "{$player['name']} played Double The Rent! Next rent will be multiplied by {$mult}x.");
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

                    // Transfer the entire set
                    if (!isset($player['property_sets'][$color])) {
                        $player['property_sets'][$color] = [];
                    }
                    foreach ($targetSet as $stolenCard) {
                        $player['property_sets'][$color][] = $stolenCard;
                    }
                    unset($target['property_sets'][$color]);

                    $state['discard'][] = $card;
                    $colorName = CardDefinitions::SET_RULES[$color]['name'];
                    self::addLog($state, "🚨 {$player['name']} played Deal Breaker on {$target['name']} and stole their entire {$colorName} set!");
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

                    if (!in_array($stolenCard['type'], ['property', 'wild_property'], true)) {
                        throw new Exception("Can only steal property or wildcard cards with Sly Deal.");
                    }

                    if (self::isCompleteSet($target['property_sets'][$foundCol], $foundCol)) {
                        throw new Exception("Cannot steal a property from a completed set with Sly Deal!");
                    }

                    // Remove from opponent
                    array_splice($target['property_sets'][$foundCol], $foundIdx, 1);
                    if (empty($target['property_sets'][$foundCol])) {
                        unset($target['property_sets'][$foundCol]);
                    }

                    // Add to active player
                    $destCol = $stolenCard['type'] === 'wild_property'
                        ? ($params['color'] ?? $stolenCard['current_color'] ?? $stolenCard['colors'][0])
                        : $foundCol;
                    if ($stolenCard['type'] === 'wild_property') {
                        $stolenCard['current_color'] = $destCol;
                    }

                    if (!isset($player['property_sets'][$destCol])) {
                        $player['property_sets'][$destCol] = [];
                    }
                    $player['property_sets'][$destCol][] = $stolenCard;

                    $state['discard'][] = $card;
                    self::addLog($state, "🕵️ {$player['name']} used Sly Deal on {$target['name']} to steal {$stolenCard['name']}!");
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

                    // Remove my card from active player, give to target
                    array_splice($player['property_sets'][$myCol], $myIdx, 1);
                    if (empty($player['property_sets'][$myCol])) unset($player['property_sets'][$myCol]);

                    // Remove target card from target, give to active player
                    array_splice($target['property_sets'][$targetCol], $targetIdx, 1);
                    if (empty($target['property_sets'][$targetCol])) unset($target['property_sets'][$targetCol]);

                    // Add targetCard to active player
                    $pDestCol = $targetCard['type'] === 'wild_property' ? ($params['my_dest_color'] ?? $targetCard['current_color'] ?? $targetCol) : $targetCol;
                    if ($targetCard['type'] === 'wild_property') $targetCard['current_color'] = $pDestCol;
                    if (!isset($player['property_sets'][$pDestCol])) $player['property_sets'][$pDestCol] = [];
                    $player['property_sets'][$pDestCol][] = $targetCard;

                    // Add myCard to target
                    $tDestCol = $myCard['type'] === 'wild_property' ? ($myCard['current_color'] ?? $myCol) : $myCol;
                    if (!isset($target['property_sets'][$tDestCol])) $target['property_sets'][$tDestCol] = [];
                    $target['property_sets'][$tDestCol][] = $myCard;

                    $state['discard'][] = $card;
                    self::addLog($state, "🔄 {$player['name']} executed Forced Deal with {$target['name']}, swapping {$myCard['name']} for {$targetCard['name']}!");
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

            $multiplier = $state['turn']['rent_multiplier'] ?? 1;
            $rentValue = $baseRent * $multiplier;
            $state['turn']['rent_multiplier'] = 1; // Consume multiplier

            $colorName = CardDefinitions::SET_RULES[$color]['name'];
            $multText = $multiplier > 1 ? " ({$multiplier}x Double Rent applied!)" : "";

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

        $totalTableValue = 0;
        foreach ($allTableCards as $info) {
            $totalTableValue += (int)($info['card']['value'] ?? 0);
        }

        // Validate selected cards
        $selectedCards = [];
        $selectedTotal = 0;
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
            $selectedTotal += (int)($info['card']['value'] ?? 0);
        }

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
            $state['discard'][] = $pending['action_card'];
            $state['pending_payment'] = null;
        }

        self::checkWinCondition($state);
        self::checkAutoEndTurn($state);
    }

    /**
     * Resolves Just Say No by payer to cancel payment.
     */
    public static function resolveJustSayNo(array &$state, string $playerId): void {
        if ($state['status'] !== 'playing') {
            throw new Exception("Game is not active.");
        }
        if (empty($state['pending_payment'])) {
            throw new Exception("No pending payment to cancel.");
        }
        $pending = &$state['pending_payment'];
        if (!isset($pending['payers'][$playerId])) {
            throw new Exception("You do not owe any payment.");
        }
        if ($pending['payers'][$playerId]['paid']) {
            throw new Exception("You have already resolved your payment.");
        }

        $payer = &$state['players'][$playerId];
        $collectorId = $pending['collector_id'];
        $collectorName = $state['players'][$collectorId]['name'] ?? 'opponent';

        // Check if payer has Just Say No in hand
        $jsnIndex = -1;
        $jsnCard = null;
        foreach ($payer['hand'] as $idx => $c) {
            if (($c['action'] ?? '') === 'just_say_no') {
                $jsnIndex = $idx;
                $jsnCard = $c;
                break;
            }
        }

        if (!$jsnCard) {
            throw new Exception("You do not have a Just Say No card in your hand.");
        }

        // Discard the Just Say No card
        array_splice($payer['hand'], $jsnIndex, 1);
        $state['discard'][] = $jsnCard;

        self::addLog($state, "🛑 {$payer['name']} played JUST SAY NO against {$collectorName}!");

        $pending['payers'][$playerId]['paid'] = true;

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
