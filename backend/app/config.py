from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Jira Insight
    jira_url: str = "https://jira.example.com"
    jira_user: str = "admin"
    jira_password: str = ""
    jira_schema_id: int = 41
    jira_vm_type_id: int = 1439
    jira_cluster_type_id: int = 1438
    jira_os_type_id: int = 1445

    # Zabbix
    zabbix_url: str = "https://zabbix.example.com"
    zabbix_user: str = "Admin"
    zabbix_password: str = ""
    zabbix_api_token: str = ""

    # Analysis thresholds
    metrics_period_days: int = 30
    cpu_oversized_threshold: float = 20.0
    cpu_undersized_threshold: float = 80.0
    ram_oversized_threshold: float = 40.0
    ram_undersized_threshold: float = 85.0
    cluster_split_threshold: float = 30.0

    # HTTP
    ssl_verify: bool = True
    request_delay: float = 0.3
    request_retries: int = 3


settings = Settings()
