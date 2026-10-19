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
        case 'create':
            $name = trim($input['name'] ?? '');
            if ($name === '') {
                throw new Exception("Please enter your name.");
            }
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
            $name = trim($input['name'] ?? '');
            if ($name === '') {
                throw new Exception("Please enter your name.");
            }

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

        case 'remove_player':
            $gameId = strtoupper(trim($input['game_id'] ?? ''));
            $hostId = trim($input['player_id'] ?? '');
            $targetPlayerId = trim($input['target_player_id'] ?? '');

            $pdo->beginTransaction();
            $stmt = $pdo->prepare("SELECT version, state FROM games WHERE id = ? FOR UPDATE");
            $stmt->execute([$gameId]);
            $row = $stmt->fetch();

            if (!$row) {
                $pdo->rollBack();
                throw new Exception("Game room not found.");
            }

            $state = json_decode($row['state'], true);
            GameEngine::removePlayerFromLobby($state, $hostId, $targetPlayerId);

            $delSig = $pdo->prepare("DELETE FROM signaling WHERE game_id = ? AND (sender_id = ? OR receiver_id = ?)");
            $delSig->execute([$gameId, $targetPlayerId, $targetPlayerId]);

            $update = $pdo->prepare("UPDATE games SET version = version + 1, state = ? WHERE id = ?");
            $update->execute([json_encode($state), $gameId]);
            $pdo->commit();

            echo json_encode([
                'ok' => true,
                'state' => GameEngine::sanitizeStateForPlayer($state, $hostId),
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

        case 'end_turn':
            $gameId = strtoupper(trim($input['game_id'] ?? ''));
            $playerId = trim($input['player_id'] ?? '');
            $discardIds = (array)($input['discard_ids'] ?? $input['discard_card_ids'] ?? []);

            $pdo->beginTransaction();
            $stmt = $pdo->prepare("SELECT version, state FROM games WHERE id = ? FOR UPDATE");
            $stmt->execute([$gameId]);
            $row = $stmt->fetch();

            if (!$row) {
                $pdo->rollBack();
                throw new Exception("Game not found.");
            }

            $state = json_decode($row['state'], true);
            GameEngine::endTurn($state, $playerId, $discardIds);

            $update = $pdo->prepare("UPDATE games SET version = version + 1, state = ? WHERE id = ?");
            $update->execute([json_encode($state), $gameId]);
            $pdo->commit();

            echo json_encode([
                'ok' => true,
                'state' => GameEngine::sanitizeStateForPlayer($state, $playerId),
            ]);
            break;

        case 'move_property':
            $gameId = strtoupper(trim($input['game_id'] ?? ''));
            $playerId = trim($input['player_id'] ?? '');
            $cardId = trim($input['card_id'] ?? '');
            $toColor = trim($input['to_color'] ?? '');

            $pdo->beginTransaction();
            $stmt = $pdo->prepare("SELECT version, state FROM games WHERE id = ? FOR UPDATE");
            $stmt->execute([$gameId]);
            $row = $stmt->fetch();

            if (!$row) {
                $pdo->rollBack();
                throw new Exception("Game not found.");
            }

            $state = json_decode($row['state'], true);
            GameEngine::moveProperty($state, $playerId, $cardId, $toColor);

            $update = $pdo->prepare("UPDATE games SET version = version + 1, state = ? WHERE id = ?");
            $update->execute([json_encode($state), $gameId]);
            $pdo->commit();

            echo json_encode([
                'ok' => true,
                'state' => GameEngine::sanitizeStateForPlayer($state, $playerId),
            ]);
            break;

        case 'pay':
            $gameId = strtoupper(trim($input['game_id'] ?? ''));
            $playerId = trim($input['player_id'] ?? '');
            $cardIds = (array)($input['card_ids'] ?? []);

            $pdo->beginTransaction();
            $stmt = $pdo->prepare("SELECT version, state FROM games WHERE id = ? FOR UPDATE");
            $stmt->execute([$gameId]);
            $row = $stmt->fetch();

            if (!$row) {
                $pdo->rollBack();
                throw new Exception("Game not found.");
            }

            $state = json_decode($row['state'], true);
            GameEngine::resolvePayment($state, $playerId, $cardIds);

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

        case 'say_no':
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
            GameEngine::resolveJustSayNo($state, $playerId);

            $update = $pdo->prepare("UPDATE games SET version = version + 1, state = ? WHERE id = ?");
            $update->execute([json_encode($state), $gameId]);
            $pdo->commit();

            echo json_encode([
                'ok' => true,
                'state' => GameEngine::sanitizeStateForPlayer($state, $playerId),
            ]);
            break;

        case 'accept_action':
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
            GameEngine::resolveAcceptAction($state, $playerId);

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
            $gameId = strtoupper(trim($input['game_id'] ?? $_GET['game_id'] ?? ''));
            $playerId = trim($input['player_id'] ?? $_GET['player_id'] ?? '');

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
                    if (!empty($state['pending_action'])) {
                        if ($state['pending_action']['initiator_id'] === $playerId || $state['pending_action']['target_id'] === $playerId) {
                            $state['discard'][] = $state['pending_action']['action_card'];
                            foreach ($state['pending_action']['jsn_chain'] ?? [] as $jsn) {
                                $state['discard'][] = $jsn['card'];
                            }
                            $state['pending_action'] = null;
                        }
                    }
                    if (!empty($state['pending_payment'])) {
                        if ($state['pending_payment']['collector_id'] === $playerId) {
                            $state['discard'][] = $state['pending_payment']['action_card'];
                            $state['pending_payment'] = null;
                        } elseif (isset($state['pending_payment']['payers'][$playerId])) {
                            unset($state['pending_payment']['payers'][$playerId]);
                            $allDone = true;
                            foreach ($state['pending_payment']['payers'] as $pInfo) {
                                if (!$pInfo['paid']) { $allDone = false; break; }
                            }
                            if ($allDone || empty($state['pending_payment']['payers'])) {
                                $state['discard'][] = $state['pending_payment']['action_card'];
                                $state['pending_payment'] = null;
                            }
                        }
                    }
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
            // 1. Purge finished games older than 30s so finished games do not persist
            $pdo->query("DELETE FROM games WHERE JSON_UNQUOTE(JSON_EXTRACT(state, '$.status')) = 'finished' AND updated_at < NOW() - INTERVAL 30 SECOND");
            // 2. Purge games with no more players/users in state
            $pdo->query("DELETE FROM games WHERE JSON_LENGTH(JSON_EXTRACT(state, '$.players')) = 0 OR JSON_EXTRACT(state, '$.players') = '{}' OR JSON_EXTRACT(state, '$.players') = '[]' OR JSON_EXTRACT(state, '$.players') IS NULL");
            // 3. Purge abandoned games where no users have been active/polling for > 2 minutes
            $pdo->query("DELETE FROM games WHERE updated_at < NOW() - INTERVAL 2 MINUTE");
            // 4. Purge orphaned or old signaling data
            $pdo->query("DELETE FROM signaling WHERE game_id NOT IN (SELECT id FROM games) OR created_at < NOW() - INTERVAL 5 MINUTE");

            $gameId = strtoupper(trim($_GET['game_id'] ?? ''));
            $playerId = trim($_GET['player_id'] ?? '');

            // Throttled heartbeat: keep game active in DB while users are polling (at most once every 15s)
            if ($gameId) {
                $touch = $pdo->prepare("UPDATE games SET updated_at = NOW() WHERE id = ? AND updated_at < NOW() - INTERVAL 15 SECOND");
                $touch->execute([$gameId]);
            }

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
