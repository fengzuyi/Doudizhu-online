CREATE TABLE `ChatMessage` (
    `id` VARCHAR(64) NOT NULL,
    `account` VARCHAR(64) NOT NULL,
    `nickname` VARCHAR(32) NOT NULL,
    `text` VARCHAR(500) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ChatMessage_account_idx`(`account`),
    INDEX `ChatMessage_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ChatMute` (
    `account` VARCHAR(64) NOT NULL,
    `mutedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `mutedBy` VARCHAR(64) NOT NULL,
    `reason` VARCHAR(255) NULL,

    INDEX `ChatMute_mutedAt_idx`(`mutedAt`),
    PRIMARY KEY (`account`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AdminAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `admin` VARCHAR(64) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `target` VARCHAR(191) NULL,
    `reason` VARCHAR(255) NULL,

    INDEX `AdminAuditLog_action_idx`(`action`),
    INDEX `AdminAuditLog_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
