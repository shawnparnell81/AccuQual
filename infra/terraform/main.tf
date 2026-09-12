terraform {
  required_version = ">= 1.6.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.110"
    }
  }

  backend "azurerm" {
    # TODO: fill in via `terraform init -backend-config=...` per environment
    # resource_group_name  = "accuqual-tfstate-rg"
    # storage_account_name = "accuqualtfstate"
    # container_name       = "tfstate"
    # key                  = "accuqual.tfstate"
  }
}

provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "main" {
  name     = "${var.project}-${var.environment}-rg"
  location = var.location
}

module "networking" {
  source              = "./networking"
  project             = var.project
  environment         = var.environment
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
}

module "acr" {
  source              = "./acr"
  project             = var.project
  environment         = var.environment
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
}

module "keyvault" {
  source              = "./keyvault"
  project             = var.project
  environment         = var.environment
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
}

module "storage" {
  source              = "./storage"
  project             = var.project
  environment         = var.environment
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
}

module "aks" {
  source              = "./aks"
  project             = var.project
  environment         = var.environment
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  subnet_id           = module.networking.aks_subnet_id
  node_count          = var.aks_node_count
  node_vm_size        = var.aks_node_vm_size
  acr_id              = module.acr.acr_id
}
