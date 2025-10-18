# Monitoring stack

This directory contains a lightweight Prometheus + Grafana stack for inspecting the proxy metrics exposed by `/metrics`.

## Usage

1. Ensure the proxy is reachable from Docker. The default Prometheus configuration points at `host.docker.internal:3000`. On Linux you may need to replace that host with the gateway IP (for example `172.17.0.1`).
2. From this directory run `docker compose up -d`.
3. Browse to Grafana at <http://localhost:3001> (default credentials `admin/admin`).
4. Open the **Levelhead / Levelhead Proxy Overview** dashboard to inspect cache efficiency, request latencies, and rate-limit activity.

Prometheus scrapes the proxy every 15 seconds and Grafana is pre-provisioned with a datasource and dashboard so the stack is ready immediately.
