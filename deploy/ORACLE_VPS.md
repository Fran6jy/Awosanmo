# Oracle Ubuntu 24.04 Deployment

This path targets Oracle Cloud Free Tier: 1 vCPU, 1GB RAM, 100GB SSD, and 2GB swap.

## 1. Prepare The Instance

Create an Ubuntu 24.04 LTS VM. In the Oracle security list or network security group, allow:

- TCP `22` for SSH
- TCP `80` and `443` for web
- TCP/UDP `51413` for torrent peers

Then SSH in and run:

```bash
sudo bash deploy/oracle-ubuntu-setup.sh
```

The script installs Docker, Compose, Nginx, Certbot, UFW rules, a 2GB swap file, and creates:

- `/opt/awosanmo`
- `/var/lib/awosanmo`
- `/var/lib/awosanmo/backups`

## 2. Copy The App

From your machine:

```bash
scp -r . ubuntu@YOUR_SERVER_IP:/tmp/awosanmo
ssh ubuntu@YOUR_SERVER_IP
sudo rsync -a --delete /tmp/awosanmo/ /opt/awosanmo/
sudo chown -R awosanmo:awosanmo /opt/awosanmo /var/lib/awosanmo
```

## 3. Configure Secrets

```bash
cd /opt/awosanmo
sudo cp .env.example .env
sudo nano .env
```

Set at minimum:

- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `CORS_ORIGIN=https://your-domain.example`

## 4. Start The App

```bash
cd /opt/awosanmo
sudo docker compose -f docker-compose.prod.yml up -d --build
sudo docker compose -f docker-compose.prod.yml logs -f
```

The container binds Awosanmo to `127.0.0.1:4000`; Nginx is the public entry point.

For repeat deploys:

```bash
sudo chmod +x /opt/awosanmo/deploy/deploy-oracle.sh
sudo /opt/awosanmo/deploy/deploy-oracle.sh
```

## 5. Configure Nginx

```bash
sudo cp /opt/awosanmo/deploy/nginx.conf /etc/nginx/sites-available/awosanmo
sudo nano /etc/nginx/sites-available/awosanmo
sudo ln -sf /etc/nginx/sites-available/awosanmo /etc/nginx/sites-enabled/awosanmo
sudo nginx -t
sudo systemctl reload nginx
```

Replace `example.com` with your real domain.

## 6. Enable TLS

```bash
sudo certbot --nginx -d your-domain.example
```

## 7. Enable Backups

```bash
sudo chmod +x /opt/awosanmo/deploy/backup.sh
sudo cp /opt/awosanmo/deploy/awosanmo-backup.service /etc/systemd/system/
sudo cp /opt/awosanmo/deploy/awosanmo-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now awosanmo-backup.timer
```

## Operations

Check health:

```bash
curl -f http://127.0.0.1:4000/health
```

Check memory:

```bash
docker stats awosanmo-awosanmo-1
free -h
```

Update:

```bash
cd /opt/awosanmo
sudo docker compose -f docker-compose.prod.yml up -d --build
```

Rollback:

```bash
cd /opt/awosanmo
sudo docker compose -f docker-compose.prod.yml logs --tail=200
sudo docker compose -f docker-compose.prod.yml restart
```
