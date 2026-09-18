from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Jira Insight
    jira_url: str = "https://jira.example.com"
    jira_user: str = "admin"
    jira_password: str = ""
    jira_schema_id: int = 3
    jira_vm_type_id: int = 86
    jira_cluster_type_id: int = 85
    jira_os_type_id: int = 92
    jira_physical_server_type_id: int = 83
    jira_application_type_id: int = 94
    jira_it_service_type_id: int = 110
    jira_db_instance_type_id: int = 88
    jira_storage_type_id: int = 87
    # Comma-separated type IDs to aggregate into one ci_type bucket
    jira_network_device_type_ids: str = "102,103,104,105"  # Router,Switch,Firewall,AP
    jira_pbx_type_ids: str = "120,121"                     # PBX Hardware, PBX Software

    def network_device_type_id_list(self) -> list[int]:
        return [int(x.strip()) for x in self.jira_network_device_type_ids.split(",") if x.strip()]

    def pbx_type_id_list(self) -> list[int]:
        return [int(x.strip()) for x in self.jira_pbx_type_ids.split(",") if x.strip()]

    # Zabbix
    zabbix_url: str = "https://zabbix.example.com"
    zabbix_user: str = "Admin"
    zabbix_password: str = ""
    zabbix_api_token: str = ""

    # vCenter (опційно — якщо vcenter_host порожній, ці метрики вимкнені)
    vcenter_host: str = ""
    vcenter_user: str = ""
    vcenter_password: str = ""
    vcenter_verify_ssl: bool = False

    # Analysis thresholds
    metrics_period_days: int = 30
    cpu_oversized_threshold: float = 20.0
    cpu_undersized_threshold: float = 80.0
    ram_oversized_threshold: float = 40.0
    ram_undersized_threshold: float = 85.0
    disk_oversized_threshold: float = 20.0
    disk_undersized_threshold: float = 85.0
    cluster_split_threshold: float = 30.0

    # Windows Server licensing (per 2-core pack)
    dc_license_price_usd: float = 769.0
    standard_license_price_usd: float = 244.0

    # HTTP
    ssl_verify: bool = False
    request_delay: float = 0.3
    request_retries: int = 3

    # CORS — через кому: http://server,http://server:5173
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
