locals {
  database_url = "postgresql://${var.db_username}:${urlencode(random_password.db_master.result)}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${var.db_name}?schema=public&connection_limit=20&pool_timeout=15"
  redis_url    = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:${aws_elasticache_cluster.main.cache_nodes[0].port}"

  app_secrets_placeholder = jsonencode({
    JWT_SECRET            = "REPLACE_ME"
    JWT_REFRESH_SECRET    = "REPLACE_ME"
    OPENAI_API_KEY        = "REPLACE_ME"
    LIVEKIT_URL           = "REPLACE_ME"
    LIVEKIT_API_KEY       = "REPLACE_ME"
    LIVEKIT_API_SECRET    = "REPLACE_ME"
    EMAIL_API_KEY         = "REPLACE_ME"
    EMAIL_FROM            = "REPLACE_ME"
    SENTRY_DSN            = ""
    AWS_ACCESS_KEY_ID     = "REPLACE_ME"
    AWS_SECRET_ACCESS_KEY = "REPLACE_ME"
    AWS_BUCKET_NAME       = "REPLACE_ME"
    AWS_REGION            = "REPLACE_ME"
    CORS_ORIGINS          = ""
    OTP_TIL_SEC           = "300"
    OTP_MAX_ATTEMPTS      = "5"
    OTP_RATE_LIMIT        = "60"
    MODERATION_WORKERS    = "1"
    PERF_TIMING           = "false"
  })
}

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${local.name_prefix}/database_url"
  description             = "Postgres connection string for the Proxima backend"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = local.database_url
}

resource "aws_secretsmanager_secret" "redis_url" {
  name                    = "${local.name_prefix}/redis_url"
  description             = "Redis connection string for the Proxima backend"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id     = aws_secretsmanager_secret.redis_url.id
  secret_string = local.redis_url
}

resource "aws_secretsmanager_secret" "app_config" {
  name                    = "${local.name_prefix}/app_config"
  description             = "Third-party API keys and JWT secret. Populate via console after first apply."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "app_config" {
  secret_id     = aws_secretsmanager_secret.app_config.id
  secret_string = local.app_secrets_placeholder

  lifecycle {
    ignore_changes = [secret_string]
  }
}
