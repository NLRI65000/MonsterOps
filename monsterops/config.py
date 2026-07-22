from __future__ import annotations

from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MONSTEROPS_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://radius:radius@localhost/radius"

    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_timeout: int = 30
    db_pool_recycle: int = 1800

    retention_auth_log_days: int = 90
    retention_audit_log_days: int = 365
    retention_notification_days: int = 90
    retention_dispatch_log_days: int = 180

    nas_probe_enabled: bool = True
    nas_probe_interval_seconds: int = 60
    nas_probe_timeout_seconds: int = 3

    console_enabled: bool = False

    require_2fa: bool = False

    tacacs_enabled: bool = False
    tacacs_host: str = "0.0.0.0"
    tacacs_port: int = 49
    tacacs_max_connections: int = 256
    tacacs_read_timeout: float = 30.0

    radius_server_ip: str = ""

    secret_key: str = "change-me-before-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30

    debug: bool = False
    allowed_origins: str = (
        ""
    )

    cookie_secure: bool | None = None

    enabled_modules: str = ""

    plugins: str = ""

    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    radius_log_files: str = "/var/log/freeradius/radius.log"

    geoip_db: str = ""

    backup_dir: str = "/var/backups/monsterops"

    freeradius_proxy_conf: str = "/etc/freeradius/3.0/proxy.conf"

    vpn_config_dir: str = "/etc/monsterops/vpn"

    firewall_ruleset_path: str = "/etc/monsterops/firewall.nft"

    firewall_country_block_enabled: bool = True
    firewall_country_block_url: str = (
        "https://www.ipdeny.com/ipblocks/data/aggregated/{cc}-aggregated.zone"
    )

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_tls: bool = False

    @property
    def module_list(self) -> list[str]:
        if not self.enabled_modules:
            return [
                "auth",
                "dashboard",
                "users",
                "groups",
                "nas",
                "nas_manager",
                "ip_pools",
                "realms",
                "vpn",
                "accounting",
                "auth_logs",
                "reports",
                "radius_logs",
                "system",
                "health",
                "notifications",
                "integrations",
                "apikeys",
                "scheduler",
                "webhooks",
                "automation",
                "firewall",
                "tacacs",
            ]
        return [m.strip() for m in self.enabled_modules.split(",") if m.strip()]

    @property
    def plugin_list(self) -> list[str]:
        return [p.strip() for p in self.plugins.split(",") if p.strip()]


settings = Settings()
