# Services Manager ⚡

A modern, fast, and secure desktop application built with **Electron**, **Vite**, **TypeScript**, and **systemd** to monitor, inspect, run, and stop system and user services on Linux.

---

## 🚀 Features

- **Running Services List**: Instantly lists all currently running services with status badges, human-readable descriptions, and execution states.
- **Service Name & File Location**: Displays both the **systemd unit file location** (e.g., `/usr/lib/systemd/system/cron.service`) and the **executable binary path** (e.g., `/usr/sbin/cron`) with one-click copy to clipboard.
- **Stop, Run & Restart Controls**:
  - **Stop**: Safely halts running background services.
  - **Run (Start)**: Starts stopped or inactive services.
  - **Restart**: Re-executes or restarts active services.
- **System & User Scope Support**:
  - **System Services** (`systemctl`): Manages system-wide daemons (Apache, MySQL, Bluetooth, Cron, etc.).
  - **User Services** (`systemctl --user`): Manages user-session services (PipeWire, GNOME services, D-Bus, etc.) without requiring root permissions.
- **Real-Time Search & State Filtering**:
  - Instant live search by service name, description, unit file path, or binary path.
  - Quick filter buttons for **Running**, **Stopped**, and **All** services.
- **Auto-Refresh**: Optional automated background refresh (every 5 seconds) to track service state changes in real time.
- **Native Privilege Escalation**: Integrates with Linux PolicyKit (`pkexec`) to display graphical authentication prompts when managing system services as a standard user.
- **Security-First Architecture**: Context isolation enabled, Node integration disabled in renderer, and strict regex input sanitization on all service unit names to prevent command injection.

---

## 📋 Prerequisites

- **Linux Operating System** with `systemd` (Ubuntu, Debian, Fedora, Arch, CentOS, openSUSE, etc.).
- **Node.js** (v18.x or later recommended).
- **npm** (v9.x or later).
- **PolicyKit (`pkexec`)**: Included by default in most desktop Linux distributions (GNOME, KDE, XFCE). Required for privilege escalation when managing system services without sudo.

---

## 🛠️ How to Run This Project

### 1. Install Dependencies

In the root directory of the project, install the required packages:

```bash
npm install
```

### 2. Start the Development Application

Launch the application using Electron Forge and Vite:

```bash
npm start
```

### 3. Running with Root / Elevated Privileges (Optional)

When running as a standard desktop user (`npm start`), clicking **Stop**, **Run**, or **Restart** on a system-level service will prompt you with the standard Linux Polkit GUI dialog to enter your administrator password.

If you prefer to run the application with administrative permissions directly without repeated Polkit prompts, launch with `sudo`:

```bash
sudo -E npm start
```

_(The `-E` flag preserves your display environment variables so Electron can connect to your desktop display)._

---

## ⚙️ How to Manage Services

### 1. Viewing Running Services

- When launched, the application defaults to displaying all **Running** system services.
- Each service card contains:
  - **Service Name**: The systemd identifier (e.g., `apache2.service`, `cron.service`).
  - **Status Badge**: Indicates whether the service is `Running`, `Stopped`, `Exited`, or `Failed`.
  - **Description**: Summary of what the service does.
  - **Location**: The absolute filesystem path to the `.service` unit file on disk.
  - **Binary**: The path to the executable binary launched by systemd (when available).

### 2. Stopping a Running Service

1. Locate the running service in the list (or use the search bar).
2. Click the red **Stop** button.
3. If managing a system service and running as a normal user, enter your password in the Polkit modal when prompted.
4. The service will stop, and a confirmation toast notification will appear.

### 3. Running (Starting) a Service

1. Click the **Stopped** or **All** filter tab in the toolbar.
2. Locate the stopped service you wish to run.
3. Click the green **Run** button.
4. Once systemd activates the service, the badge updates to **Running**, and the service appears in the running list.

### 4. Restarting a Service

1. For any active service, click the **Restart** button.
2. Systemd will reload or restart the service daemon cleanly.

### 5. Managing User Services vs System Services

- Click **System Services** (top right) to manage system daemons (`/usr/lib/systemd/system/`).
- Click **User Services** (top right) to manage session services (`/usr/lib/systemd/user/`). User services do not require root or Polkit authentication to start or stop.

### 6. Copying Service Locations

- Click the clipboard icon (`📋`) next to **Location** or **Binary** to copy the full path to your clipboard.

### 7. Searching and Auto-Refresh

- **Search**: Type any text in the search input to instantly filter by service name, description, or filesystem path.
- **Auto-Refresh**: Toggle the "Auto-refresh" switch in the toolbar to automatically poll and update the status of services every 5 seconds.

---

## 📦 Building & Packaging

### Package Application

Creates an executable folder in `out/`:

```bash
npm run package
```

### Create Distributable Installers (.deb, .rpm, .zip)

Builds native Linux distribution packages in `out/make/`:

```bash
npm run make
```

---

## 🧪 Code Quality & Verification

- **Lint & Format Check**:
  ```bash
  npm run lint
  ```
- **Automatically Fix Formatting**:
  ```bash
  npm run lint:fix
  ```
- **TypeScript Typecheck**:
  ```bash
  npm run typecheck
  ```

---

## 🔒 Security Architecture

- **Context Isolation**: Renderer runs isolated from Node.js APIs (`contextIsolation: true`, `nodeIntegration: false`).
- **Preload Bridge**: Strictly typed APIs exposed via Electron `contextBridge`.
- **Whitelisted Unit Names**: Service names sent to systemctl are validated against `/^[a-zA-Z0-9_.@-]+$/` to eliminate shell injection risks.
- **Direct Process Execution**: Uses `child_process.execFile` with argument arrays rather than shell string concatenation.
