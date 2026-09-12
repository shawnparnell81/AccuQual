resource "azurerm_storage_account" "main" {
  name                     = "${var.project}${var.environment}files"
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "ZRS"
  min_tls_version          = "TLS1_2"
}

resource "azurerm_storage_container" "files" {
  name                  = "accuqual-files"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}
