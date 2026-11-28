# Deploying FinSim to Oracle Cloud Infrastructure (Always Free Tier)

This guide walks you through deploying a production-ready FinSim instance onto an **Oracle Cloud Infrastructure (OCI) Always Free** virtual machine using Docker Compose and the Caddy automated TLS reverse proxy.

---

## 1. Architecture & Security Model

```
                    ┌────────────────────────────────────────────────────────┐
                    │               OCI Compute Instance (VM)                │
                    │                                                        │
Internet ─────────► │  [ Ports 80 & 443: Caddy Reverse Proxy ]               │
(HTTPS + Auto-TLS)  │    ├─ Automatic Let's Encrypt / ZeroSSL certificate    │
                    │    ├─ Strict security headers (HSTS, nosniff, DENY)    │
                    │    └─ Ingress rate limiting                            │
                    │                    │                                   │
                    │         (Internal Docker Network)                      │
                    │                    ├──► [ finsim-web:80 ] (Cockpit UI)   │
                    │                    ▼                                   │
                    │          [ finsim-api:8080 ]                           │
                    │          ├── postgres:5432 (NO host port exposed)      │
                    │          ├── bank-a:9001 (internal mock)               │
                    │          └── bank-b:9002 (internal mock)               │
                    └────────────────────────────────────────────────────────┘
```

### Security Safeguards:
- **No Direct Database Exposure:** PostgreSQL runs strictly on an internal Docker bridge network (`finsim-net`). Port 5432 is **never** published to the VM host or public internet.
- **SSRF & Metadata Defense:** The `prod` profile sets `allow-private-addresses: false` (blocking RFC 1918, loopback, CGNAT `100.64.0.0/10`, and IPv6 ULA `fc00::/7`) while explicitly allowing only Docker bridge service names (`FINSIM_REGISTRY_INTERNAL_HOSTS=bank-a,bank-b`), and unconditionally rejects link-local metadata addresses (`169.254.169.254`, `fe80::/10`), preventing any external user from probing OCI instance metadata or internal networks.
- **CORS Restricted:** Cross-Origin Resource Sharing is controlled via `FINSIM_CORS_ALLOWED_ORIGINS` to allow your same-origin HTTPS domain (for example, `https://<your-domain>`) and any approved external dashboards (e.g. a Vercel deployment or local dev server).
- **Automated TLS:** Caddy terminates TLS and negotiates certificates automatically via Let's Encrypt / ZeroSSL with zero manual renewal needed (`ACME_EMAIL` in `.env` sets the global Caddy `email` directive automatically).

> [!WARNING]
> **Public exposure boundary:** Per [SECURITY.md](../SECURITY.md), FinSim's `/api/v1/*` endpoints currently have no authentication. While `allow-private-addresses: false` blocks SSRF into private networks and cloud metadata, any visitor who can reach Caddy's `/api/*` routes on a public IP can register public institutions, inject faults, or execute synthetic transfers on the shared sandbox. Until [#177](https://github.com/mhnuk2007/finsim/issues/177) lands the `prod` mutating-endpoint guard, restrict public demos to isolated sandboxes or firewall/IP-allowlist port 80/443 to trusted operators.

---

## 2. Provisioning the OCI Always Free Instance

1. Log in to the [Oracle Cloud Console](https://cloud.oracle.com).
2. Navigate to **Compute** &rarr; **Instances** &rarr; **Create Instance**.
3. Choose the configuration:
   - **Shape (Recommended):** `VM.Standard.A1.Flex` (Ampere Arm Processor)
     - OCPUs: `2` (up to 4 free)
     - Memory: `12 GB` (up to 24 GB free)
     - *Alternative:* `VM.Standard.E2.1.Micro` (AMD, 1 OCPU, 1 GB RAM)
   - **Image:** `Ubuntu 24.04 LTS` or `Oracle Linux 9`
   - **Networking:** Assign a public IPv4 address.
   - **SSH Keys:** Download your private key or upload your public key.
4. Click **Create** and wait for the instance status to turn green (**Running**). Note your **Public IP Address**.

---

## 3. Configuring OCI Security Lists (Network Firewall)

In the OCI Console:
1. Navigate to your Instance details &rarr; Click the **Virtual Cloud Network (VCN)** link &rarr; Select your **Public Subnet** &rarr; Click **Default Security List**.
2. Under **Ingress Rules**, ensure the following rules are present:

| Source CIDR | IP Protocol | Destination Port Range | Description |
|---|---|---|---|
| `0.0.0.0/0` | TCP | `22` | SSH Administration |
| `0.0.0.0/0` | TCP | `80` | HTTP (Caddy ACME Challenge & Redirect) |
| `0.0.0.0/0` | TCP | `443` | HTTPS (Caddy TLS Termination) |

> [!CAUTION]
> **Do NOT add ingress rules for port 5432, 5433, 8080, 9001, or 9002.** Internal database and API ports must remain strictly unreachable from the internet.

---

## 4. Configuring OS Firewall on the VM

SSH into your VM:
```bash
ssh -i /path/to/private-key ubuntu@<YOUR_PUBLIC_IP>
```

Oracle Cloud Linux images include host-level firewall rules that must be opened for HTTP/HTTPS:

### On Ubuntu:
```bash
sudo iptables -I INPUT 6 -p tcp --dport 80 -m conntrack --ctstate NEW,ESTABLISHED -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 443 -m conntrack --ctstate NEW,ESTABLISHED -j ACCEPT
sudo netfilter-persistent save
```

### On Oracle Linux:
```bash
sudo firewall-cmd --permanent --zone=public --add-service=http
sudo firewall-cmd --permanent --zone=public --add-service=https
sudo firewall-cmd --reload
```

---

## 5. Installing Docker & Docker Compose

Run the official Docker convenience script:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
# Log out and log back in for group changes to take effect:
exit
```

Re-connect via SSH and verify:
```bash
docker --version
docker compose version
```

---

## 6. Deploying FinSim

1. Clone the FinSim repository:
   ```bash
   git clone https://github.com/mhnuk2007/finsim.git
   cd finsim
   ```

2. Initialize your production `.env` file:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` with your preferred editor:
   ```bash
   nano .env
   ```
   Set strong values:
   ```env
   # Strong generated password:
   POSTGRES_PASSWORD=generate_a_random_32_char_secret_here

   # Your domain name pointing to the VM's public IP (e.g. finsim.yourdomain.com)
   # If testing directly on IP without a domain, set DOMAIN_NAME=:80
   DOMAIN_NAME=finsim.yourdomain.com

   # Optional email for Let's Encrypt certificate notices
   ACME_EMAIL=your-email@example.com

   # Allowed CORS origins (include https://<DOMAIN_NAME> and any external dashboards)
   FINSIM_CORS_ALLOWED_ORIGINS=https://finsim.yourdomain.com,https://finsim.vercel.app,http://localhost:3000

   # Registry SSRF policy (blocks private addresses while allowing internal container hosts bank-a,bank-b)
   FINSIM_REGISTRY_ALLOW_PRIVATE_ADDRESSES=false
   FINSIM_REGISTRY_INTERNAL_HOSTS=bank-a,bank-b
   ```

> [!TIP]
> **Swap Space & Builds for Micro Instances (`VM.Standard.E2.1.Micro`):**
> If deploying on a 1 GB RAM Micro instance, configure 2 GB of swap memory to prevent the Linux OOM killer during Gradle/Vite builds or JVM startup:
> ```bash
> sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
> echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
> ```
> To avoid slow in-Docker Gradle compilation on 1 GB RAM VMs, you can build sequentially (`docker compose -f docker-compose.prod.yml build --parallel 1`) or pre-build `./gradlew :finsim-api:bootJar --no-daemon -x test` locally and copy the jar into `finsim-api/build/libs/` (`finsim-api/Dockerfile` automatically reuses a pre-built executable jar when present).

4. Build and start the production stack:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

5. Check container health status:
   ```bash
   docker compose -f docker-compose.prod.yml ps
   ```
   You should see all containers running and healthy:
   - `finsim-postgres` (healthy)
   - `finsim-bank-a` (healthy)
   - `finsim-bank-b` (healthy)
   - `finsim-api` (healthy)
   - `finsim-web` (healthy)
   - `finsim-caddy` (running)

---

## 7. Verification

Verify the deployment from your local machine:

1. **Simulation Cockpit UI:**
   ```bash
   curl -i https://<your-domain>/
   ```
   Expected response: `HTTP/2 200` serving the Vite/React Simulation Cockpit (`text/html`), connected in **Live API** mode via same-origin `/api/*` and `/actuator/health`.

   Check the API documentation separately:
   ```bash
   curl -i https://<your-domain>/swagger-ui.html
   curl -i https://<your-domain>/swagger-ui/index.html
   curl -i https://<your-domain>/v3/api-docs
   curl -i https://<your-domain>/v3/api-docs/swagger-config
   ```
   Expect a redirect from `/swagger-ui.html` to `/swagger-ui/index.html`, Swagger UI HTML at the destination, and JSON from both OpenAPI endpoints. Documentation requests must reach the API, rather than return the Cockpit HTML fallback.

2. **Health Check:**
   ```bash
   curl -i https://<your-domain>/actuator/health
   ```
   Expected response:
   ```json
   HTTP/2 200
   {"status":"UP"}
   ```

3. **CORS Preflight Test (for external frontend origins):**
   ```bash
   curl -i -X OPTIONS https://<your-domain>/api/v1/networks/sandbox/directory \
     -H "Origin: https://finsim.vercel.app" \
     -H "Access-Control-Request-Method: GET"
   ```
   Expected response:
   ```http
   HTTP/2 200
   access-control-allow-origin: https://finsim.vercel.app
   access-control-allow-methods: GET,POST,PUT,DELETE,PATCH,OPTIONS
   ```

4. **Verify Database Isolation:**
   Attempting to connect to port 5432 or 5433 from outside the VM should be completely rejected or timed out:
   ```bash
   nc -zv <YOUR_PUBLIC_IP> 5432
   # Connection timed out or refused
   ```

---

## 8. Maintenance & Backups

- **Viewing logs:**
  ```bash
  docker compose -f docker-compose.prod.yml logs -f finsim-api
  docker compose -f docker-compose.prod.yml logs -f caddy
  ```
- **Updating to latest version:**
  ```bash
  git pull origin main
  docker compose -f docker-compose.prod.yml up -d --build
  ```
- **Backing up PostgreSQL data:**
  ```bash
  docker compose -f docker-compose.prod.yml exec postgres pg_dump -U finsim finsim > finsim_backup_$(date +%F).sql
  ```
