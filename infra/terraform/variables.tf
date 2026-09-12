variable "project" {
  description = "Project name, used as a resource naming prefix"
  type        = string
  default     = "accuqual"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "location" {
  description = "Azure region"
  type        = string
  default     = "eastus"
}

variable "aks_node_count" {
  description = "Initial AKS node pool size"
  type        = number
  default     = 3
}

variable "aks_node_vm_size" {
  type    = string
  default = "Standard_D2s_v5"
}

variable "postgres_sku_name" {
  description = "Azure Database for PostgreSQL Flexible Server SKU"
  type        = string
  default     = "GP_Standard_D2s_v3"
}
