-- ============================================================
-- Giant Motor Cars CRM — V2 schema (MySQL / MariaDB)
--
-- Run this once against an empty database. setup.php will do it
-- for you, or paste it into phpMyAdmin → SQL if you'd rather.
-- Safe to re-run: every statement is CREATE TABLE IF NOT EXISTS.
--
-- No foreign keys on purpose. Message history should survive a
-- customer being deleted, and Frazer re-imports shouldn't be able
-- to fail on a constraint mid-batch.
-- ============================================================

-- password_hash is nullable on purpose: a Google-only user has no password
-- at all, which is the point — there is nothing left to guess.
CREATE TABLE IF NOT EXISTS `users` (
  `id`            CHAR(36)     NOT NULL,
  `email`         VARCHAR(190) NOT NULL,
  `name`          VARCHAR(120) NOT NULL DEFAULT '',
  `password_hash` VARCHAR(255) NULL DEFAULT NULL,
  `google_sub`    VARCHAR(64)  NULL DEFAULT NULL,
  `is_admin`      TINYINT(1)   NOT NULL DEFAULT 0,
  `is_active`     TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_login_at` DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `leads` (
  `id`               CHAR(36)     NOT NULL,
  `dc_id`            VARCHAR(80)  NULL DEFAULT NULL,
  `name`             VARCHAR(190) NOT NULL DEFAULT '',
  `phone`            VARCHAR(40)  NULL DEFAULT NULL,
  `email`            VARCHAR(190) NULL DEFAULT NULL,
  `vehicle`          VARCHAR(190) NULL DEFAULT NULL,
  `stock_number`     VARCHAR(60)  NULL DEFAULT NULL,
  `source`           VARCHAR(80)  NULL DEFAULT NULL,
  `status`           VARCHAR(40)  NOT NULL DEFAULT 'new',
  `deal_type`        VARCHAR(40)  NULL DEFAULT NULL,
  `assigned_to`      VARCHAR(120) NULL DEFAULT NULL,
  `credit_score`     INT          NULL DEFAULT NULL,
  `notes`            TEXT         NULL DEFAULT NULL,
  `email_opt_out`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `stage_changed_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_leads_status` (`status`),
  KEY `idx_leads_stage`  (`stage_changed_at`),
  KEY `idx_leads_email`  (`email`),
  KEY `idx_leads_dc`     (`dc_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sold_customers` (
  `id`                       CHAR(36)      NOT NULL,
  `first_name`               VARCHAR(120)  NULL DEFAULT NULL,
  `last_name`                VARCHAR(120)  NULL DEFAULT NULL,
  `home_phone`               VARCHAR(40)   NULL DEFAULT NULL,
  `cell_phone`               VARCHAR(40)   NULL DEFAULT NULL,
  `email`                    VARCHAR(190)  NULL DEFAULT NULL,
  `sale_date`                DATE          NULL DEFAULT NULL,
  `sale_type`                VARCHAR(60)   NULL DEFAULT NULL,
  `veh_year`                 VARCHAR(10)   NULL DEFAULT NULL,
  `veh_make`                 VARCHAR(60)   NULL DEFAULT NULL,
  `veh_model`                VARCHAR(90)   NULL DEFAULT NULL,
  `vin`                      VARCHAR(40)   NULL DEFAULT NULL,
  `vin_last6`                VARCHAR(12)   NULL DEFAULT NULL,
  `first_payment_date`       DATE          NULL DEFAULT NULL,
  `note_payment_amount`      DECIMAL(12,2) NULL DEFAULT NULL,
  `pay_schedule`             VARCHAR(40)   NULL DEFAULT NULL,
  `num_payments`             VARCHAR(20)   NULL DEFAULT NULL,
  `current_due_date`         DATE          NULL DEFAULT NULL,
  `service_contract`         VARCHAR(20)   NULL DEFAULT NULL,
  `service_contract_company` VARCHAR(120)  NULL DEFAULT NULL,
  `lien_holder`              VARCHAR(120)  NULL DEFAULT NULL,
  `cobuyer_first`            VARCHAR(120)  NULL DEFAULT NULL,
  `cobuyer_last`             VARCHAR(120)  NULL DEFAULT NULL,
  `cobuyer_home_phone`       VARCHAR(40)   NULL DEFAULT NULL,
  `cobuyer_email`            VARCHAR(190)  NULL DEFAULT NULL,
  `tag_in`                   TINYINT(1)    NOT NULL DEFAULT 0,
  `tag_cost`                 DECIMAL(10,2) NULL DEFAULT NULL,
  `tag_number`               VARCHAR(40)   NULL DEFAULT NULL,
  `email_opt_out`            TINYINT(1)    NOT NULL DEFAULT 0,
  `created_at`               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sold_date`  (`sale_date`),
  KEY `idx_sold_email` (`email`),
  KEY `idx_sold_vin6`  (`vin_last6`),
  KEY `idx_sold_lien`  (`lien_holder`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- body is MEDIUMTEXT, not TEXT: a template with an inlined image runs to
-- hundreds of KB as a data: URI, and TEXT would truncate it at 64 KB.
CREATE TABLE IF NOT EXISTS `message_templates` (
  `id`          CHAR(36)     NOT NULL,
  `name`        VARCHAR(190) NOT NULL,
  `subject`     TEXT         NULL DEFAULT NULL,
  `body`        MEDIUMTEXT   NULL DEFAULT NULL,
  `category`    VARCHAR(80)  NULL DEFAULT NULL,
  `record_type` VARCHAR(20)  NOT NULL DEFAULT 'lead',
  `channel`     VARCHAR(20)  NOT NULL DEFAULT 'email',
  `is_active`   TINYINT(1)   NOT NULL DEFAULT 1,
  `sort_order`  INT          NOT NULL DEFAULT 0,
  `created_by`  VARCHAR(120) NULL DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tpl_type` (`record_type`, `channel`, `is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `messages` (
  `id`                  CHAR(36)     NOT NULL,
  `record_type`         VARCHAR(20)  NOT NULL,
  `record_id`           VARCHAR(64)  NOT NULL,
  `template_id`         CHAR(36)     NULL DEFAULT NULL,
  `channel`             VARCHAR(20)  NOT NULL DEFAULT 'email',
  `to_address`          VARCHAR(190) NULL DEFAULT NULL,
  `to_name`             VARCHAR(190) NULL DEFAULT NULL,
  `subject`             TEXT         NULL DEFAULT NULL,
  `body`                MEDIUMTEXT   NULL DEFAULT NULL,
  `status`              VARCHAR(20)  NOT NULL DEFAULT 'sent',
  `error`               TEXT         NULL DEFAULT NULL,
  `provider_message_id` VARCHAR(120) NULL DEFAULT NULL,
  `provider_thread_id`  VARCHAR(120) NULL DEFAULT NULL,
  `batch_id`            VARCHAR(64)  NULL DEFAULT NULL,
  `sent_by`             VARCHAR(120) NULL DEFAULT NULL,
  `from_address`        VARCHAR(190) NULL DEFAULT NULL,
  `sent_at`             DATETIME     NULL DEFAULT NULL,
  `created_at`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_msg_record`  (`record_type`, `record_id`),
  KEY `idx_msg_created` (`created_at`),
  KEY `idx_msg_batch`   (`batch_id`),
  KEY `idx_msg_status`  (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lead_activities` (
  `id`         CHAR(36)     NOT NULL,
  `lead_id`    CHAR(36)     NOT NULL,
  `author`     VARCHAR(120) NULL DEFAULT NULL,
  `type`       VARCHAR(40)  NOT NULL DEFAULT 'note',
  `body`       TEXT         NULL DEFAULT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_act_lead` (`lead_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Feeds the login throttle. Pruned automatically as it's written to.
CREATE TABLE IF NOT EXISTS `login_attempts` (
  `id`    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ip`    VARCHAR(45)  NOT NULL,
  `email` VARCHAR(190) NULL DEFAULT NULL,
  `at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_att_ip` (`ip`, `at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
