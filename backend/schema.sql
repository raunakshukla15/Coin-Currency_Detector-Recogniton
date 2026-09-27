-- Run this once against your MySQL server (e.g. via the MySQL CLI or MySQL Workbench).
-- Example: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS coinscan CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE coinscan;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(40) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS contact_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(40) DEFAULT '',
  email VARCHAR(255) DEFAULT '',
  rating TINYINT UNSIGNED NOT NULL DEFAULT 0,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Per-user uploaded image bytes (scan images, chatbot images, collection images).
-- Images are stored as BLOB/LONGBLOB because this project has no external object
-- storage and images are downscaled to <=1024px JPEG before upload.
CREATE TABLE IF NOT EXISTS user_images (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  mime_type VARCHAR(50) NOT NULL DEFAULT 'image/jpeg',
  byte_size INT UNSIGNED NOT NULL DEFAULT 0,
  data LONGBLOB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_images_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_images_user_created (user_id, created_at)
) ENGINE=InnoDB;

-- Chatbot conversations (one row per conversation, owned by a user)
CREATE TABLE IF NOT EXISTS chats (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(100) NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_chats_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_chats_user_updated (user_id, updated_at)
) ENGINE=InnoDB;

-- Individual chatbot messages belonging to a conversation
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  chat_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('user', 'assistant') NOT NULL,
  content MEDIUMTEXT NOT NULL,
  image_id BIGINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_msgs_chat FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  CONSTRAINT fk_msgs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_msgs_image FOREIGN KEY (image_id) REFERENCES user_images(id) ON DELETE SET NULL,
  INDEX idx_msgs_chat_created (chat_id, created_at),
  INDEX idx_msgs_user (user_id)
) ENGINE=InnoDB;

-- Coin/currency scan & identification history
CREATE TABLE IF NOT EXISTS scan_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  image_id BIGINT UNSIGNED DEFAULT NULL,
  name VARCHAR(255) NOT NULL DEFAULT 'Identified Coin',
  detected_country VARCHAR(100) NOT NULL DEFAULT '',
  detected_currency VARCHAR(100) NOT NULL DEFAULT '',
  denomination VARCHAR(100) NOT NULL DEFAULT '',
  confidence TINYINT UNSIGNED NOT NULL DEFAULT 0,
  authenticity_status ENUM('LIKELY_GENUINE', 'SUSPICIOUS', 'LIKELY_COUNTERFEIT', 'UNABLE_TO_VERIFY')
    NOT NULL DEFAULT 'UNABLE_TO_VERIFY',
  authenticity_message VARCHAR(512) NOT NULL DEFAULT '',
  items_json MEDIUMTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_scans_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_scans_image FOREIGN KEY (image_id) REFERENCES user_images(id) ON DELETE SET NULL,
  INDEX idx_scans_user_created (user_id, created_at)
) ENGINE=InnoDB;

-- Per-user coin collection (replaces browser localStorage collection)
CREATE TABLE IF NOT EXISTS collection_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  coin_id VARCHAR(64) NOT NULL,
  image_id BIGINT UNSIGNED DEFAULT NULL,
  item_json MEDIUMTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_coll_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_coll_image FOREIGN KEY (image_id) REFERENCES user_images(id) ON DELETE SET NULL,
  UNIQUE KEY uq_coll_user_coin (user_id, coin_id),
  INDEX idx_coll_user (user_id, created_at)
) ENGINE=InnoDB;