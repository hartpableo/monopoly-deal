-- Monopoly Deal Database Schema
-- MariaDB / MySQL

CREATE TABLE IF NOT EXISTS games (
    id VARCHAR(36) PRIMARY KEY,
    version INT NOT NULL DEFAULT 1,
    state LONGTEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS signaling (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    game_id VARCHAR(36) NOT NULL,
    sender_id VARCHAR(36) NOT NULL,
    receiver_id VARCHAR(36) NOT NULL,
    message LONGTEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_game_recv (game_id, receiver_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
