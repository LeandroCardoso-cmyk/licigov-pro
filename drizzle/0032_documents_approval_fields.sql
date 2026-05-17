ALTER TABLE `documents` ADD `createdBy` int;
ALTER TABLE `documents` ADD `documentStatus` enum('draft','in_review','approved','rejected') NOT NULL DEFAULT 'draft';
