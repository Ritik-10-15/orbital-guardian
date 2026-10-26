# AWS Free Tier demo deployment

This deployment runs the full demo on one EC2 instance: nginx serves the React
app, FastAPI handles REST and WebSocket traffic, and PostgreSQL stores the
shared fleet and mission history on the instance's encrypted EBS volume. It
does not create RDS, NAT Gateway, load balancer, CloudFront, WAF, or a static
Elastic IP.

The setup is prepared in this repository. **No AWS resources have been created.**

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
2. Push this deployment configuration and app changes to the public GitHub
   branch you plan to deploy. The instance clones that branch during startup;
   visitors only need the resulting app link, not GitHub.
3. In the same AWS region you will deploy to, create or choose an EC2 key pair.
   Find your current public IPv4 address; the template restricts SSH to that
   address with `/32`.
4. Confirm the region has the `t4g.small` instance type and that it is eligible
   for your account. Do not create an Elastic IP or other services alongside
   this stack.

## Launch

1. Open **CloudFormation > Create stack > With new resources (standard)**.
2. Upload [`aws/free-tier-ec2.yaml`](aws/free-tier-ec2.yaml).
3. Enter a stack name and set `KeyPairName` and `AllowedSshCidr` to your key
   pair and public IPv4 address with `/32`. Change the repository URL or branch
   if you deploy a different public repo/branch.
4. Create the stack. The template creates one VPC, public subnet, security
   group, and one `t4g.small` EC2 instance with a 20 GiB encrypted `gp3` root
   volume. The instance builds the containers on first boot; this can take
   several minutes.
5. The stack can reach `CREATE_COMPLETE` before the first container build
   finishes. Allow several more minutes, then open the **AppUrl** output. It is
   an HTTP URL without TLS. The instance's public hostname may change if you
   stop and start it; check the stack output again for the current URL.

The database password is generated on the instance and stored in a root-owned
environment file with owner-only permissions. PostgreSQL is not exposed to the
internet. Fleet edits and mission decisions are interactive and shared by
everyone who visits the URL. There is no login, so use demo data only.

If the app does not come up, SSH from the allowed IP and inspect the bootstrap
and container logs:

```bash
sudo tail -n 100 /var/log/cloud-init-output.log
cd /opt/orbital-guardian
sudo docker compose --env-file .env.aws -f docker-compose.aws-free.yml logs
```

## Update and cleanup

To update a running instance after pushing a new commit, SSH from the allowed
IP and run:

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
