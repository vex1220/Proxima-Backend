variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
}

variable "project_name" {
  description = "Short identifier prefixed onto resource names"
  type        = string
  default     = "proxima"
}

variable "environment" {
  description = "Deployment environment (prod, staging, dev)"
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.20.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDRs for public subnets, one per AZ"
  type        = list(string)
  default     = ["10.20.0.0/20", "10.20.16.0/20"]
}

variable "private_subnet_cidrs" {
  description = "CIDRs for private subnets, one per AZ"
  type        = list(string)
  default     = ["10.20.32.0/20", "10.20.48.0/20"]
}

variable "app_port" {
  description = "Container port the Express app listens on"
  type        = number
  default     = 8000
}

variable "db_name" {
  description = "Initial Postgres database name"
  type        = string
  default     = "proxima"
}

variable "db_username" {
  description = "Postgres master username"
  type        = string
  default     = "proxima_app"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage" {
  description = "RDS storage in GB (gp3)"
  type        = number
  default     = 50
}

variable "db_engine_version" {
  description = "Postgres engine version"
  type        = string
  default     = "16.13"
}

variable "db_deletion_protection" {
  description = "Block accidental destroy of the RDS instance"
  type        = bool
  default     = true
}

variable "db_skip_final_snapshot" {
  description = "Skip final snapshot when destroying RDS (true only for disposable envs)"
  type        = bool
  default     = false
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.micro"
}

variable "redis_engine_version" {
  description = "ElastiCache Redis engine version"
  type        = string
  default     = "7.1"
}

variable "task_cpu" {
  description = "Fargate task CPU units (1024 = 1 vCPU)"
  type        = number
  default     = 1024
}

variable "task_memory" {
  description = "Fargate task memory in MB"
  type        = number
  default     = 2048
}

variable "desired_count" {
  description = "Number of ECS tasks to run"
  type        = number
  default     = 1
}

variable "image_tag" {
  description = "ECR image tag the service runs"
  type        = string
  default     = "latest"
}
