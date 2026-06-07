CREATE TABLE `GameSessionRecord` (
  `id` VARCHAR(191) NOT NULL,
  `account` VARCHAR(64) NOT NULL,
  `nickname` VARCHAR(32) NOT NULL,
  `gameKind` VARCHAR(32) NOT NULL,
  `gameName` VARCHAR(32) NOT NULL,
  `roomCode` VARCHAR(16) NOT NULL,
  `seat` INTEGER NULL,
  `enteredAt` DATETIME(3) NOT NULL,
  `leftAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finalScore` INTEGER NOT NULL DEFAULT 0,
  `scoreLabel` VARCHAR(64) NOT NULL,
  `resultLabel` VARCHAR(128) NULL,
  `leaveReason` VARCHAR(64) NULL,
  `phase` VARCHAR(32) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `GameSessionRecord_account_leftAt_idx` ON `GameSessionRecord`(`account`, `leftAt`);
CREATE INDEX `GameSessionRecord_gameKind_idx` ON `GameSessionRecord`(`gameKind`);
CREATE INDEX `GameSessionRecord_roomCode_idx` ON `GameSessionRecord`(`roomCode`);
