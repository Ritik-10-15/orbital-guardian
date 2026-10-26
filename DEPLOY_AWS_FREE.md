# AWS Free Tier demo deployment

This deployment runs the full demo on one EC2 instance: nginx serves the React
app, FastAPI handles REST and WebSocket traffic, and PostgreSQL stores the
shared fleet and mission history on the instance's encrypted EBS volume. It
does not create RDS, NAT Gateway, load balancer, CloudFront, WAF, or a static
Elastic IP.

The setup is prepared in this repository. Launching the CloudFormation template
creates AWS resources in the selected region.

## Free Tier limits

AWS Free Tier eligibility depends on the account and its remaining credits. New
AWS customers can receive $100 in signup credits and earn up to another $100.
The Free account plan ends when credits are exhausted or after six months,
whichever comes first; AWS then closes the account. On a Paid plan, usage beyond
credits can be billed. Check the AWS Billing console before launching anything.
[AWS Free Tier FAQs](https://aws.amazon.com/free/free-tier-faqs/) ·
[AWS account plans](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html)

The template defaults to `t4g.small`, which AWS lists as eligible for customers
who opened accounts on or after July 15, 2025, for the first six months or
until credits are exhausted. That does not make the whole deployment
guaranteed-free: EC2, EBS storage, and network usage count against your
account's offer or credits. The older 12-month EC2 offer for accounts
created before July 15, 2025 has already elapsed as of October 2026. See
[EC2 Free Tier eligibility](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html).

## Before launch

1. In **Billing and Cost Management**, confirm your account plan, remaining
   credits, and Free Tier status. Do not upgrade a Free account plan unless you
   accept that usage beyond credits can be billed.
2. The deployment configuration and app changes are pushed to the public
   `aws-free-tier-deploy` branch, which the template uses by default. The
   instance clones that branch during startup; visitors only need the resulting
   app link, not GitHub.
3. Confirm your AWS role can create IAM roles and instance profiles. The stack
   uses Systems Manager Session Manager for administration, so no SSH key or
   inbound SSH port is needed. Session Manager has no additional charge for EC2
   instances ([AWS pricing](https://aws.amazon.com/systems-manager/pricing/)).
4. Confirm the region has the `t4g.small` instance type and that it is eligible
   for your account. Do not create an Elastic IP or other services alongside
   this stack.

## Launch

1. Open **CloudFormation > Create stack > With new resources (standard)**.
2. Upload [`aws/free-tier-ec2.yaml`](aws/free-tier-ec2.yaml).
3. Enter a stack name. Change the repository URL or branch if you deploy a
   different public repo or branch.
4. Create the stack. The template creates one VPC, public subnet, security
   group, and one `t4g.small` EC2 instance with a 20 GiB encrypted `gp3` root
   volume. The security group exposes only HTTP port 80. The instance builds
   the containers on first boot; this can take several minutes.
5. The stack can reach `CREATE_COMPLETE` before the first container build
   finishes. Allow several more minutes, then open the **AppUrl** output. It is
   an HTTP URL without TLS. The instance's public hostname may change if you
   stop and start it; check the stack output again for the current URL.

The database password is generated on the instance and stored in a root-owned
environment file with owner-only permissions. PostgreSQL is not exposed to the
internet. Fleet edits and mission decisions are interactive and shared by
everyone who visits the URL. There is no login, so use demo data only.

If the app does not come up, first check the instance's **Status checks** and
**Actions > Monitor and troubleshoot > Get system log**. If the initial
bootstrap stopped before cloning the repository, use **Systems Manager > Run
Command** with the `AWS-RunShellScript` document, target the instance ID from
the stack's `InstanceId` output, and run the following commands. The script
creates a fresh database password and starts the containers. Run Command
executes this as root; do not paste a password into the command text.

```bash
set -euo pipefail
dnf install -y docker git openssl
systemctl enable --now docker
systemctl enable --now amazon-ssm-agent

mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL --retry 5 https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64 -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
fi

git clone --depth 1 --single-branch --branch 'aws-free-tier-deploy' 'https://github.com/Ritik-10-15/orbital-guardian.git' /opt/orbital-guardian
chown -R ec2-user:ec2-user /opt/orbital-guardian
cd /opt/orbital-guardian
DB_PASSWORD="$(openssl rand -hex 24)"
cat > .env.aws <<EOF
DB_PASSWORD=$DB_PASSWORD
POSTGRES_USER=orbital
POSTGRES_DB=orbital_guardian
PUBLIC_READ_ONLY=false
VITE_PUBLIC_READ_ONLY=false
ALLOW_LOCAL_STATE_IMPORT=false
OPENAI_API_KEY=
SPACETRACK_USER=
SPACETRACK_PASS=
CELESTRAK_USER_AGENT=OrbitalGuardian/1.0 (educational project)
MAX_DEBRIS_OBJECTS=200
EOF
chown root:root .env.aws
chmod 600 .env.aws

docker compose --env-file .env.aws -f docker-compose.aws-free.yml build
docker compose --env-file .env.aws -f docker-compose.aws-free.yml up -d
```

After the command succeeds, allow the build a few minutes and open the stack's
`AppUrl` output. For container diagnostics once `/opt/orbital-guardian` exists,
use Session Manager and run:

```bash
cd /opt/orbital-guardian
sudo docker compose --env-file .env.aws -f docker-compose.aws-free.yml logs
```

## Update and cleanup

To update a running instance after pushing a new commit, open the instance
through **EC2 > Instances > Connect > Session Manager** and run:

```bash
cd /opt/orbital-guardian
git pull --ff-only
sudo docker compose --env-file .env.aws -f docker-compose.aws-free.yml build
sudo docker compose --env-file .env.aws -f docker-compose.aws-free.yml up -d
```

To retire the demo, export any data you need, then delete the CloudFormation
stack. The EC2 instance and its root volume are deleted with the stack, so the
PostgreSQL data is deleted too. Stopping the instance preserves its EBS data,
but the site becomes unavailable and the public hostname can change. An
unattached or retained EBS volume can still incur charges.

For the more separated production-style design, see [DEPLOYMENT.md](DEPLOYMENT.md).
