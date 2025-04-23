  CREATE TABLE ops_ (
      room_id   TEXT NOT NULL,
      seq       BIGINT NOT NULL,
      site_id   INT    NOT NULL,
      ts        TIMESTAMPTZ DEFAULT now(),
      op_bin    BYTEA  NOT NULL,
      PRIMARY KEY (room_id, seq)
  );

  