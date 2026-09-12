output "aks_cluster_name" {
  value = module.aks.cluster_name
}

output "acr_login_server" {
  value = module.acr.login_server
}

output "storage_account_name" {
  value = module.storage.account_name
}

output "key_vault_uri" {
  value = module.keyvault.vault_uri
}
