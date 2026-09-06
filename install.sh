#!/bin/bash
# Installer for calibre-opds-server
#
# Expects the linux x64 single-file executable next to this script:
#   ./calibre-opds-server-linux-x64
# Build it on your machine with: bun run build:linux
# Then: scp install.sh calibre-opds-server-linux-x64 you@server:
# And:  ssh you@server bash install.sh

user=$(whoami)
app_dir="$HOME/calibre-opds-server"
log_dir="$HOME/.logs"
log="$log_dir/calibre-opds-server.log"
lock="$HOME/.install/.calibre-opds-server.lock"
env_file="$app_dir/calibre-opds-server.env"
unit_file="$HOME/.config/systemd/user/calibre-opds-server.service"
binary_name="calibre-opds-server-linux-x64"

mkdir -p "$log_dir" "$HOME/.install"
touch "$log"

binary_path="$(cd "$(dirname "$0")" && pwd)/$binary_name"

function _port() {
    comm -23 <(seq 5900 9900 | sort) <(ss -Htan | awk '{print $4}' | cut -d':' -f2 | sort -u) | shuf | head -n 1
}

function _install() {
    echo "Beginning installation..."

    if [[ ! -x "$binary_path" ]]; then
        echo "Executable not found at ${binary_path}"
        echo "Build it with 'bun run build:linux' and copy it next to this script."
        exit 1
    fi

    read -r -p "Calibre library directory (must contain metadata.db): " library_dir
    library_dir="${library_dir/#\~/$HOME}"
    if [[ ! -f "$library_dir/metadata.db" ]]; then
        echo "No metadata.db in ${library_dir}"
        exit 1
    fi

    read -r -p "Basic auth username (leave empty to disable auth): " auth_user
    auth_pass=""
    if [[ -n "$auth_user" ]]; then
        read -r -s -p "Basic auth password: " auth_pass
        echo
    fi

    mkdir -p "$app_dir"
    echo "Installing executable"
    cp "$binary_path" "$app_dir/calibre-opds-server"
    chmod +x "$app_dir/calibre-opds-server"

    port=$(_port)
    echo "Writing environment file"
    {
        echo "CALIBRE_LIBRARY_DIR=${library_dir}"
        [[ -n "$auth_user" ]] && echo "CALIBRE_USERNAME=${auth_user}"
        [[ -n "$auth_user" ]] && echo "CALIBRE_PASSWORD=${auth_pass}"
        echo "PORT=${port}"
    } >"$env_file"
    chmod 600 "$env_file"

    mkdir -p "$HOME/.config/systemd/user"
    echo "Writing service file"
    cat >"$unit_file" <<-SERV
[Unit]
Description=Calibre OPDS server

[Service]
EnvironmentFile=$env_file
ExecStart=$app_dir/calibre-opds-server
Type=simple
Restart=on-failure
RestartSec=10
StandardOutput=append:$log
StandardError=append:$log

[Install]
WantedBy=default.target
SERV

    systemctl --user daemon-reload
    echo "Starting service..."
    systemctl --user enable --now calibre-opds-server -q
    touch "$lock"

    if command -v loginctl >/dev/null 2>&1; then
        loginctl enable-linger "$user" 2>>"$log" || \
            echo "Note: could not enable lingering; the service will stop when you log out."
    fi

    echo "Installed. OPDS catalog: http://$(hostname):${port}/opds"
    echo "Logs: ${log}"
}

function _upgrade() {
    if [[ ! -f "$lock" ]]; then
        echo "calibre-opds-server is not installed"
        exit 1
    fi
    if [[ ! -x "$binary_path" ]]; then
        echo "Executable not found at ${binary_path}"
        exit 1
    fi
    echo "Installing new executable"
    cp "$binary_path" "$app_dir/calibre-opds-server"
    chmod +x "$app_dir/calibre-opds-server"
    systemctl --user try-restart calibre-opds-server
    echo "Upgraded and restarted."
}

function _remove() {
    if [[ ! -f "$lock" ]]; then
        echo "calibre-opds-server is not installed"
        exit 1
    fi
    systemctl --user stop calibre-opds-server
    systemctl --user disable calibre-opds-server
    rm -rf "$app_dir"
    rm -f "$unit_file"
    rm -f "$lock"
    systemctl --user daemon-reload
    echo "Removed. Your calibre library and ${log} were left alone."
}

echo "Welcome to the calibre-opds-server installer..."
echo ""
echo "Logs are stored at ${log}"
echo "install = Install the server (executable must sit next to this script)"
echo "upgrade = Replace the executable and restart"
echo "uninstall = Remove the server; keeps your library and logs"
echo "exit = Exits installer"
while true; do
    read -r -p "Enter it here: " choice
    case $choice in
        "install")
            _install
            break
            ;;
        "upgrade")
            _upgrade
            break
            ;;
        "uninstall")
            _remove
            break
            ;;
        "exit")
            break
            ;;
        *)
            echo "Unknown Option."
            ;;
    esac
done
exit
