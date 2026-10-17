<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/engine.php';

$pdo = getDb();
$action = $_GET['action'] ?? '';
$input = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];

try {
    switch ($action) {
        case 'demo':
            $gameId = 'DEMO01';
            $myId = 'p_demo_me';
            $p2Id = 'p_demo_sarah';
            $p3Id = 'p_demo_alex';

            $now = time();
            $state = [
                'status' => 'playing',
                'deck' => CardDefinitions::createDeck(),
                'discard' => [
                    ['id' => 'card_d1', 'type' => 'action', 'action' => 'pass_go', 'name' => 'Pass Go', 'value' => 1, 'desc' => 'Draw 2 extra cards.', 'colors' => []],
                    ['id' => 'card_d2', 'type' => 'rent', 'name' => 'Rent (Red / Yellow)', 'value' => 1, 'colors' => ['red', 'yellow']],
                ],
                'players' => [
                    $myId => [
                        'id' => $myId,
                        'name' => 'You',
                        'is_host' => true,
                        'bank' => [
                            ['id' => 'card_b1', 'type' => 'money', 'name' => '$5M Money', 'value' => 5, 'colors' => []],
                            ['id' => 'card_b2', 'type' => 'money', 'name' => '$2M Money', 'value' => 2, 'colors' => []],
                            ['id' => 'card_b3', 'type' => 'action', 'action' => 'birthday', 'name' => "It's My Birthday", 'value' => 2, 'desc' => 'All players pay you $2M.', 'colors' => []],
                        ],
                        'property_sets' => [
                            'dark_blue' => [
                                ['id' => 'card_db1', 'type' => 'property', 'name' => 'Boardwalk', 'value' => 4, 'group' => 'dark_blue', 'colors' => ['dark_blue']],
                                ['id' => 'card_db2', 'type' => 'property', 'name' => 'Park Place', 'value' => 4, 'group' => 'dark_blue', 'colors' => ['dark_blue']],
                            ],
                            'green' => [
                                ['id' => 'card_gr1', 'type' => 'property', 'name' => 'North Carolina Avenue', 'value' => 4, 'group' => 'green', 'colors' => ['green']],
                                ['id' => 'card_gr2', 'type' => 'property', 'name' => 'Pacific Avenue', 'value' => 4, 'group' => 'green', 'colors' => ['green']],
                            ],
                            'railroad' => [
                                ['id' => 'card_rr1', 'type' => 'property', 'name' => 'Reading Railroad', 'value' => 2, 'group' => 'railroad', 'colors' => ['railroad']],
                            ],
                        ],
                        'hand' => [
                            ['id' => 'card_h1', 'type' => 'action', 'action' => 'deal_breaker', 'name' => 'Deal Breaker', 'value' => 5, 'desc' => 'Steal a completed set of properties.', 'colors' => []],
                            ['id' => 'card_h2', 'type' => 'action', 'action' => 'pass_go', 'name' => 'Pass Go', 'value' => 1, 'desc' => 'Draw 2 extra cards.', 'colors' => []],
                            ['id' => 'card_h3', 'type' => 'action', 'action' => 'debt_collector', 'name' => 'Debt Collector', 'value' => 3, 'desc' => 'Force any player to pay you $5M.', 'colors' => []],
                            ['id' => 'card_h4', 'type' => 'property', 'name' => 'Pennsylvania Avenue', 'value' => 4, 'group' => 'green', 'colors' => ['green']],
                            ['id' => 'card_h5', 'type' => 'wild_property', 'name' => 'Wild Property (Red / Yellow)', 'value' => 3, 'colors' => ['red', 'yellow'], 'current_color' => 'red'],
                            ['id' => 'card_h6', 'type' => 'money', 'name' => '$10M Money', 'value' => 10, 'colors' => []],
                        ],
                    ],
                    $p2Id => [
                        'id' => $p2Id,
                        'name' => 'Sarah',
                        'is_host' => false,
                        'bank' => [
                            ['id' => 'card_sb1', 'type' => 'money', 'name' => '$3M Money', 'value' => 3, 'colors' => []],
                            ['id' => 'card_sb2', 'type' => 'money', 'name' => '$1M Money', 'value' => 1, 'colors' => []],
                        ],
                        'property_sets' => [
                            'brown' => [
                                ['id' => 'card_sbr1', 'type' => 'property', 'name' => 'Mediterranean Avenue', 'value' => 1, 'group' => 'brown', 'colors' => ['brown']],
                                ['id' => 'card_sbr2', 'type' => 'property', 'name' => 'Baltic Avenue', 'value' => 1, 'group' => 'brown', 'colors' => ['brown']],
                            ],
                            'yellow' => [
                                ['id' => 'card_sy1', 'type' => 'property', 'name' => 'Atlantic Avenue', 'value' => 3, 'group' => 'yellow', 'colors' => ['yellow']],
                                ['id' => 'card_sy2', 'type' => 'property', 'name' => 'Ventnor Avenue', 'value' => 3, 'group' => 'yellow', 'colors' => ['yellow']],
                            ],
                        ],
                        'hand' => [
                            ['id' => 'sh1'], ['id' => 'sh2'], ['id' => 'sh3'], ['id' => 'sh4']
                        ],
                    ],
                    $p3Id => [
                        'id' => $p3Id,
                        'name' => 'Alex',
                        'is_host' => false,
                        'bank' => [
                            ['id' => 'card_ab1', 'type' => 'money', 'name' => '$4M Money', 'value' => 4, 'colors' => []],
                        ],
                        'property_sets' => [
                            'orange' => [
                                ['id' => 'card_ao1', 'type' => 'property', 'name' => 'New York Avenue', 'value' => 2, 'group' => 'orange', 'colors' => ['orange']],
                                ['id' => 'card_ao2', 'type' => 'property', 'name' => 'St. James Place', 'value' => 2, 'group' => 'orange', 'colors' => ['orange']],
                            ],
                            'utility' => [
                                ['id' => 'card_au1', 'type' => 'property', 'name' => 'Electric Company', 'value' => 2, 'group' => 'utility', 'colors' => ['utility']],
                            ],
                        ],
                        'hand' => [
                            ['id' => 'ah1'], ['id' => 'ah2'], ['id' => 'ah3'], ['id' => 'ah4'], ['id' => 'ah5']
                        ],
                    ],
                ],
                'turn_order' => [$myId, $p2Id, $p3Id],
                'turn' => [
                    'active_player_id' => $myId,
                    'actions_left' => 3,
                    'turn_number' => 4,
                ],
                'winner_id' => null,
                'logs' => [
                    ['time' => $now - 120, 'text' => 'Game started with 3 players.'],
                    ['time' => $now - 95, 'text' => 'Sarah completed the Brown property set (2/2)!'],
                    ['time' => $now - 60, 'text' => 'Alex banked $4M Money.'],
                    ['time' => $now - 30, 'text' => 'Sarah passed turn to Alex.'],
                    ['time' => $now - 10, 'text' => "Now it's Your turn! You drew 2 cards."],
                ],
            ];

            // Save to DB
            $stmt = $pdo->prepare("INSERT INTO games (id, version, state) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE version = version + 1, state = VALUES(state)");
            $stmt->execute([$gameId, json_encode($state)]);

            echo json_encode([
                'ok' => true,
                'game_id' => $gameId,
                'player_id' => $myId,
                'state' => GameEngine::sanitizeStateForPlayer($state, $myId),
            ]);
            break;

        case 'create':
            $name = trim($input['name'] ?? '') ?: 'Host';
            $gameId = strtoupper(substr(bin2hex(random_bytes(3)), 0, 6)); // 6-char room code
            $state = GameEngine::createGame($name);
            $hostId = array_key_first($state['players']);

            $stmt = $pdo->prepare("INSERT INTO games (id, version, state) VALUES (?, 1, ?)");
            $stmt->execute([$gameId, json_encode($state)]);

            echo json_encode([
                'ok' => true,
                'game_id' => $gameId,
                'player_id' => $hostId,
                'state' => GameEngine::sanitizeStateForPlayer($state, $hostId),
            ]);
            break;

        case 'join':
            $gameId = strtoupper(trim($input['game_id'] ?? ''));
            $name = trim($input['name'] ?? '') ?: 'Player';

            $pdo->beginTransaction();
            $stmt = $pdo->prepare("SELECT version, state FROM games WHERE id = ? FOR UPDATE");
            $stmt->execute([$gameId]);
            $row = $stmt->fetch();

            if (!$row) {
                $pdo->rollBack();
                throw new Exception("Game room not found.");
            }

            $state = json_decode($row['state'], true);
            $newPlayerId = GameEngine::joinGame($state, $name);

            $update = $pdo->prepare("UPDATE games SET version = version + 1, state = ? WHERE id = ?");
            $update->execute([json_encode($state), $gameId]);
            $pdo->commit();

            echo json_encode([
                'ok' => true,
                'game_id' => $gameId,
                'player_id' => $newPlayerId,
                'state' => GameEngine::sanitizeStateForPlayer($state, $newPlayerId),
            ]);
            break;

        case 'start':
            $gameId = strtoupper(trim($input['game_id'] ?? ''));
            $playerId = trim($input['player_id'] ?? '');

            $pdo->beginTransaction();
            $stmt = $pdo->prepare("SELECT version, state FROM games WHERE id = ? FOR UPDATE");
            $stmt->execute([$gameId]);
            $row = $stmt->fetch();

            if (!$row) {
                $pdo->rollBack();
                throw new Exception("Game not found.");
            }

            $state = json_decode($row['state'], true);
            GameEngine::startGame($state, $playerId);

            $update = $pdo->prepare("UPDATE games SET version = version + 1, state = ? WHERE id = ?");
            $update->execute([json_encode($state), $gameId]);
            $pdo->commit();

            echo json_encode([
                'ok' => true,
                'state' => GameEngine::sanitizeStateForPlayer($state, $playerId),
            ]);
            break;

        case 'play':
            $gameId = strtoupper(trim($input['game_id'] ?? ''));
            $playerId = trim($input['player_id'] ?? '');
            $cardId = trim($input['card_id'] ?? '');
            $targetType = trim($input['target_type'] ?? '');
            $params = (array)($input['params'] ?? []);

            $pdo->beginTransaction();
            $stmt = $pdo->prepare("SELECT version, state FROM games WHERE id = ? FOR UPDATE");
            $stmt->execute([$gameId]);
            $row = $stmt->fetch();

            if (!$row) {
                $pdo->rollBack();
                throw new Exception("Game not found.");
            }

            $state = json_decode($row['state'], true);
            GameEngine::playCard($state, $playerId, $cardId, $targetType, $params);

            // If game finished, purge all voice signaling data immediately
            if ($state['status'] === 'finished') {
                $delSig = $pdo->prepare("DELETE FROM signaling WHERE game_id = ?");
                $delSig->execute([$gameId]);
            }

            $update = $pdo->prepare("UPDATE games SET version = version + 1, state = ? WHERE id = ?");
            $update->execute([json_encode($state), $gameId]);
            $pdo->commit();

            echo json_encode([
                'ok' => true,
                'state' => GameEngine::sanitizeStateForPlayer($state, $playerId),
            ]);
            break;

        case 'leave':
            $gameId = strtoupper(trim($input['game_id'] ?? ''));
            $playerId = trim($input['player_id'] ?? '');

            $stmt = $pdo->prepare("SELECT state FROM games WHERE id = ?");
            $stmt->execute([$gameId]);
            $row = $stmt->fetch();

            if ($row) {
                $state = json_decode($row['state'], true);
                // Purge completely from DB if the game is finished, or if host leaves, or no players remain
                if ($state['status'] === 'finished' || ($state['players'][$playerId]['is_host'] ?? false)) {
                    $pdo->prepare("DELETE FROM games WHERE id = ?")->execute([$gameId]);
                    $pdo->prepare("DELETE FROM signaling WHERE game_id = ?")->execute([$gameId]);
                } else {
                    unset($state['players'][$playerId]);
                    $state['turn_order'] = array_values(array_filter($state['turn_order'], fn($id) => $id !== $playerId));
                    if (empty($state['players'])) {
                        $pdo->prepare("DELETE FROM games WHERE id = ?")->execute([$gameId]);
                        $pdo->prepare("DELETE FROM signaling WHERE game_id = ?")->execute([$gameId]);
                    } else {
                        $pdo->prepare("UPDATE games SET state = ? WHERE id = ?")->execute([json_encode($state), $gameId]);
                    }
                }
            }
            echo json_encode(['ok' => true]);
            break;

        case 'state':
            // Purge finished games older than 30s so no finished games or recordings persist in DB
            $pdo->query("DELETE FROM games WHERE JSON_UNQUOTE(JSON_EXTRACT(state, '$.status')) = 'finished' AND updated_at < NOW() - INTERVAL 30 SECOND");
            $pdo->query("DELETE FROM signaling WHERE created_at < NOW() - INTERVAL 5 MINUTE");

            $gameId = strtoupper(trim($_GET['game_id'] ?? ''));
            $playerId = trim($_GET['player_id'] ?? '');

            $stmt = $pdo->prepare("SELECT version, state FROM games WHERE id = ?");
            $stmt->execute([$gameId]);
            $row = $stmt->fetch();

            if (!$row) {
                throw new Exception("Game not found.");
            }

            $state = json_decode($row['state'], true);
            echo json_encode([
                'ok' => true,
                'version' => (int)$row['version'],
                'state' => GameEngine::sanitizeStateForPlayer($state, $playerId),
            ]);
            break;

        // WebRTC Signaling
        case 'signal':
            $gameId = strtoupper(trim($input['game_id'] ?? ''));
            $senderId = trim($input['sender_id'] ?? '');
            $receiverId = trim($input['receiver_id'] ?? '');
            $message = json_encode($input['message'] ?? []);

            $stmt = $pdo->prepare("INSERT INTO signaling (game_id, sender_id, receiver_id, message) VALUES (?, ?, ?, ?)");
            $stmt->execute([$gameId, $senderId, $receiverId, $message]);

            echo json_encode(['ok' => true]);
            break;

        case 'signals':
            $gameId = strtoupper(trim($_GET['game_id'] ?? ''));
            $playerId = trim($_GET['player_id'] ?? '');

            $stmt = $pdo->prepare("SELECT id, sender_id, message FROM signaling WHERE game_id = ? AND receiver_id = ? ORDER BY id ASC");
            $stmt->execute([$gameId, $playerId]);
            $rows = $stmt->fetchAll();

            if (!empty($rows)) {
                $ids = array_column($rows, 'id');
                $inQuery = implode(',', array_fill(0, count($ids), '?'));
                $del = $pdo->prepare("DELETE FROM signaling WHERE id IN ({$inQuery})");
                $del->execute($ids);
            }

            $signals = [];
            foreach ($rows as $r) {
                $signals[] = [
                    'sender_id' => $r['sender_id'],
                    'message' => json_decode($r['message'], true),
                ];
            }

            echo json_encode(['ok' => true, 'signals' => $signals]);
            break;

        default:
            throw new Exception("Unknown action.");
    }
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
