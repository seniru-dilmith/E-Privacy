-- Cloud-side store. Holds ciphertext, coarse grouping dimensions and the
-- bulletin board. No identifier or plaintext measure ever lands here.

CREATE TABLE users (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  username  VARCHAR(64)  NOT NULL UNIQUE,
  role      ENUM('owner', 'auditor', 'admin') NOT NULL,
  pass_hash VARCHAR(255) NOT NULL
);

CREATE TABLE sessions (
  token      CHAR(64) PRIMARY KEY,
  user_id    INT      NOT NULL,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE campaigns (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(120) NOT NULL,
  key_bits     SMALLINT     NOT NULL,
  n            TEXT         NOT NULL,          -- public modulus, hex
  g            TEXT         NOT NULL,          -- generator, hex
  metrics      JSON         NOT NULL,          -- [{name, scale, squared}]
  record_count INT          NOT NULL DEFAULT 0,
  plaintext_bytes BIGINT    NOT NULL DEFAULT 0,          -- size of the source rows, reported by the owner
  merkle_root  CHAR(64)     NULL,
  status       ENUM('uploading', 'committed') NOT NULL DEFAULT 'uploading',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE records (
  campaign_id     INT         NOT NULL,
  seq             INT         NOT NULL,
  department      VARCHAR(32) NOT NULL,
  ward_type       VARCHAR(16) NOT NULL,
  admission_type  VARCHAR(16) NOT NULL,
  insurance_type  VARCHAR(24) NOT NULL,
  admission_month CHAR(7)     NOT NULL,
  sex             CHAR(1)     NOT NULL,
  age_band        VARCHAR(8)  NOT NULL,
  cipher          LONGBLOB    NOT NULL,         -- fixed-width ciphertexts, concatenated
  leaf_hash       CHAR(64)    NOT NULL,
  PRIMARY KEY (campaign_id, seq),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- Append-only, hash-chained, signed. payload is stored as the exact string
-- that was hashed so key order can never drift.
CREATE TABLE board (
  seq         INT PRIMARY KEY,
  kind        VARCHAR(32) NOT NULL,
  campaign_id INT         NULL,
  payload     LONGTEXT    NOT NULL,
  prev_hash   CHAR(64)    NOT NULL,
  hash        CHAR(64)    NOT NULL,
  sig         CHAR(128)   NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE TABLE query_log (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  username    VARCHAR(64)  NULL,
  role        VARCHAR(16)  NULL,
  action      VARCHAR(48)  NOT NULL,
  campaign_id INT          NULL,
  detail      VARCHAR(255) NULL,
  records     INT          NULL,
  ms          INT          NULL,
  outcome     ENUM('allowed', 'denied', 'error') NOT NULL
);
CREATE INDEX query_log_at ON query_log (at);
