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
            ],
            'winner_id' => null,
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
                self::addLog($state, "{$player['name']} banked {$card['name']} ({$card['value']}M).");
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
                    $card['current_color'] = $color;
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
    }

    public static function endTurn(array &$state, string $playerId, array $discardCardIds = []): void {
        if ($state['status'] !== 'playing') {
            throw new Exception("Game is not active.");
        }
        if ($state['turn']['active_player_id'] !== $playerId) {
            throw new Exception("Not your turn!");
        }

        $player = &$state['players'][$playerId];

        // Hand limit check (max 7 cards at end of turn)
        $excessCount = count($player['hand']) - 7;
        if ($excessCount > 0) {
            if (count($discardCardIds) !== $excessCount) {
                throw new Exception("You must discard exactly {$excessCount} card(s) to end your turn.");
            }

            foreach ($discardCardIds as $dId) {
                $found = false;
                foreach ($player['hand'] as $hIdx => $hCard) {
                    if ($hCard['id'] === $dId) {
                        $state['discard'][] = $hCard;
                        array_splice($player['hand'], $hIdx, 1);
                        $found = true;
                        break;
                    }
                }
                if (!$found) {
                    throw new Exception("Card to discard not found in hand.");
                }
            }
        }

        // Advance to next player
        $order = $state['turn_order'];
        $currentIndex = array_search($playerId, $order, true);
        $nextIndex = ($currentIndex + 1) % count($order);
        $nextPlayerId = $order[$nextIndex];

        $state['turn']['active_player_id'] = $nextPlayerId;
        $state['turn']['actions_left'] = 3;
        $state['turn']['turn_number']++;

        $drawCount = count($state['players'][$nextPlayerId]['hand']) === 0 ? 5 : 2;
        self::drawCardsForPlayer($state, $nextPlayerId, $drawCount);

        $nextName = $state['players'][$nextPlayerId]['name'];
        self::addLog($state, "{$player['name']} ended their turn. Now it's {$nextName}'s turn.");
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
                    // Each opponent pays 2M to active player
                    foreach ($state['players'] as $targetId => &$target) {
                        if ($targetId === $playerId) continue;
                        self::transferPayment($target, $player, 2);
                    }
                    unset($target);
                    $state['discard'][] = $card;
                    self::addLog($state, "{$player['name']} played It's My Birthday! Collected up to 2M from each player.");
                    return;

                case 'debt_collector':
                    $targetId = $params['target_player_id'] ?? null;
                    if (!$targetId || !isset($state['players'][$targetId]) || $targetId === $playerId) {
                        throw new Exception("Select a valid target player for Debt Collector.");
                    }
                    $target = &$state['players'][$targetId];
                    self::transferPayment($target, $player, 5);
                    $state['discard'][] = $card;
                    self::addLog($state, "{$player['name']} used Debt Collector on {$target['name']} for up to 5M.");
                    return;

                default:
                    // For remaining actions, discard card for now
                    $state['discard'][] = $card;
                    self::addLog($state, "{$player['name']} played {$card['name']}.");
                    return;
            }
        }

        // Rent card
        if (in_array($card['type'], ['rent', 'rent_wild'], true)) {
            $color = $params['color'] ?? $card['colors'][0];
            $rentValue = self::calculateRent($player, $color);

            if ($rentValue > 0) {
                foreach ($state['players'] as $targetId => &$target) {
                    if ($targetId === $playerId) continue;
                    self::transferPayment($target, $player, $rentValue);
                }
                unset($target);
            }
            $state['discard'][] = $card;
            self::addLog($state, "{$player['name']} charged {$rentValue}M rent for " . CardDefinitions::SET_RULES[$color]['name'] . ".");
            return;
        }

        $state['discard'][] = $card;
    }

    private static function calculateRent(array $player, string $color): int {
        $count = count($player['property_sets'][$color] ?? []);
        if ($count === 0) return 0;

        $rule = CardDefinitions::SET_RULES[$color];
        $rentIndex = min($count - 1, count($rule['rent']) - 1);
        return $rule['rent'][$rentIndex];
    }

    /**
     * Deducts up to $amount from payer's bank or properties and transfers to collector.
     */
    private static function transferPayment(array &$payer, array &$collector, int $amount): void {
        $remaining = $amount;

        // Pay from bank first
        while ($remaining > 0 && !empty($payer['bank'])) {
            $paidCard = array_shift($payer['bank']);
            $collector['bank'][] = $paidCard;
            $remaining -= $paidCard['value'];
        }

        // Pay from properties if bank was insufficient
        if ($remaining > 0) {
            foreach ($payer['property_sets'] as $color => &$cards) {
                while ($remaining > 0 && !empty($cards)) {
                    $paidCard = array_shift($cards);
                    $collector['property_sets'][$color][] = $paidCard;
                    $remaining -= $paidCard['value'];
                }
            }
            unset($cards);
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
                $required = CardDefinitions::SET_RULES[$color]['size'];
                if (count($cards) >= $required) {
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
            }
        }
        unset($p);

        $clean['my_player_id'] = $playerId;
        return $clean;
    }
}
