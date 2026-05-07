output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "ecs_tasks_security_group_id" {
  value = aws_security_group.ecs_tasks.id
}

output "rds_security_group_id" {
  value = aws_security_group.rds.id
}

output "redis_security_group_id" {
  value = aws_security_group.redis.id
}

output "app_log_group_name" {
  value = aws_cloudwatch_log_group.app.name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "rds_endpoint" {
  value = aws_db_instance.main.address
}

output "rds_port" {
  value = aws_db_instance.main.port
}

output "redis_endpoint" {
  value = aws_elasticache_cluster.main.cache_nodes[0].address
}

output "database_url_secret_arn" {
  value = aws_secretsmanager_secret.database_url.arn
}

output "redis_url_secret_arn" {
  value = aws_secretsmanager_secret.redis_url.arn
}

output "app_config_secret_arn" {
  value = aws_secretsmanager_secret.app_config.arn
}

output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.app.name
}

output "github_actions_role_arn" {
  value = aws_iam_role.github_actions_deploy.arn
}

output "acm_certificate_arn" {
  value = aws_acm_certificate.api.arn
}

output "acm_validation_records" {
  description = "Add these as CNAME records at your DNS registrar to validate the ACM cert"
  value = [
    for dvo in aws_acm_certificate.api.domain_validation_options : {
      record_name  = dvo.resource_record_name
      record_type  = dvo.resource_record_type
      record_value = dvo.resource_record_value
    }
  ]
}

output "api_traffic_target" {
  description = "Add a CNAME record at your registrar: api.<yourdomain> -> this value"
  value       = aws_lb.main.dns_name
}
