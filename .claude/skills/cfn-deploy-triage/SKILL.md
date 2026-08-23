---
name: cfn-deploy-triage
description: Diagnose a failed or rolled-back CloudFormation / SAM deployment, and work out which IAM permissions a deploying identity is actually missing. Use when sam deploy or aws cloudformation deploy ends in ROLLBACK_COMPLETE, CREATE_FAILED, "Failed to create managed resources", UnauthorizedTaggingOperation, or "Requires capabilities", or when a deploy fails and the cause is suspected to be permissions. Also use before granting deploy permissions for a new stack, to enumerate them in one pass instead of discovering them one failure at a time.
---

# Triaging a failed CloudFormation deploy

The summary a failed deploy prints is not the cause. This skill is about getting
to the cause in one pass, and about not being misled by two specific traps that
waste whole afternoons.

## First: the error you were shown is probably not the error

Three layers each hide the real message:

1. **`sam deploy` prints the waiter's complaint**, not the resource's.
   "Waiter StackCreateComplete failed ... matched ROLLBACK_COMPLETE" means only
   "something failed". It never names what.
2. **The root stack's events name the nested stack**, not the resource inside it.
   With nested stacks, `describe-stack-events` on the root says
   "Embedded stack ... was not successfully created: [SomeResource]" — the reason
   lives one level down.
3. **The resource error's first sentence can be the wrong sentence.** A role that
   fails with `UnauthorizedTaggingOperation: Encountered a permissions error
   performing a tagging operation` is usually not a tagging problem: the nested
   message says `iam:CreateRole` denied. CloudFormation propagates stack tags onto
   resources, so both permissions are genuinely needed — but read to the end
   before acting on the first line.

## The procedure

**1. Get the real reason.** This is the command that answers the question:

```sh
aws cloudformation describe-stack-events --stack-name <stack> --region <region> \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`].[LogicalResourceId,ResourceType,ResourceStatusReason]' \
  --output text
```

**2. If it names an embedded/nested stack, recurse into it.** Take the nested
stack's full ARN from the root's events (`PhysicalResourceId`) and pass that as
`--stack-name`. This still works after the nested stack has been deleted by the
rollback, which is why it beats reading the console.

**3. Ask what *succeeded*.** This is the highest-value step and the easiest to
skip. Listing the completed resources converts "the deploy failed" into "exactly
this resource type is the remaining problem":

```sh
aws cloudformation describe-stack-events --stack-name <nested-arn> --region <region> \
  --query 'reverse(StackEvents[].[ResourceStatus,ResourceType,LogicalResourceId])' \
  --output text | grep -E 'CREATE_COMPLETE|CREATE_FAILED'
```

If the log group, the roles and the function all created and only the schedule
failed, the missing permission set is small and specific.

**4. Clear the wreckage before retrying.** A stack in `ROLLBACK_COMPLETE` cannot
be updated, only deleted, and it blocks recreating the same name:

```sh
aws cloudformation delete-stack --stack-name <stack> --region <region>
aws cloudformation wait stack-delete-complete --stack-name <stack> --region <region>
```

Check what survived on purpose before assuming a clean slate — SAM's managed
artifact bucket stack persists deliberately, and so does anything created
out-of-band (a `SecureString` parameter cannot be a stack resource, so it is
never rolled back).

## Trap 1: AWS validates input before it authorizes

Probing a permission by calling it with deliberately invalid arguments **does not
work**, and it fails in the dangerous direction — it reports success.

| Probe | Response | Wrong reading | Truth |
|---|---|---|---|
| `s3api create-bucket --bucket BAD_NAME` | `InvalidBucketName` | allowed | may be denied |
| `iam create-role --role-name 'bad name!!'` | `ValidationError` | allowed | may be denied |

Input validation runs first, so a validation error tells you nothing about
authorization. **Only an explicit `AccessDenied` / `AccessDeniedException` is
evidence, and only of a denial.** Its absence is not evidence of a grant.

The correct tool:

```sh
aws iam simulate-principal-policy \
  --policy-source-arn "$(aws sts get-caller-identity --query Arn --output text)" \
  --action-names s3:CreateBucket ssm:PutParameter iam:CreateRole
```

But note `iam:SimulatePrincipalPolicy` is itself a permission a restricted user
usually lacks — the call then fails with `AccessDenied` about *simulating*, not
about what you asked. When that happens there is no reliable way to enumerate
your own permissions from inside that identity. Ask someone who can read the
attached policies, or accept that the deploy is the probe.

## Trap 2: a partially-granted service looks like a broken resource

A service can be granted for `Create*` but not `Get*`. CloudFormation **reads a
resource back after creating it**, so the create succeeds and the read-back is
denied — which surfaces as a resource creation failure. `scheduler:CreateSchedule`
without `scheduler:GetSchedule` fails exactly this way.

When granting for a resource type, grant the read alongside the write. Treat a
service as available only when every action the deploy performs on it is allowed.

## Enumerate, do not iterate

A failed deploy reveals **only the first** missing permission. Fixing it reveals
the second. Each cycle costs a full deploy plus a rollback plus a stack deletion.

So do not use the deploy as a discovery loop. Write down every permission the
stack's resources will need — including the read-backs, the tagging actions, and
whatever the tooling itself does (SAM creates an S3 bucket and uploads to it) —
grant the whole set, and let one deploy confirm it.

Deploy-time permissions are usually broader than the running system's. Two
distinct identities are involved and they should not be conflated: the
**deploying principal** creates roles, buckets and schedules; the **execution
role** the stack creates only needs what the function does at runtime. Grant the
execution role narrowly even while the deploying principal is broad.

## When it is not permissions

- `Requires capabilities: [CAPABILITY_AUTO_EXPAND]` — nested stacks and macros
  need it. Pin it in `samconfig.toml` rather than passing it by hand.
- A resource that "cannot be created" may be one CloudFormation cannot express at
  all. `AWS::SSM::Parameter` supports `String` and `StringList` only, never
  `SecureString` — no permission fixes that; the resource has to live outside
  the stack.
- `sam build` output is not the transformed template. To see what CloudFormation
  actually received: `aws cloudformation get-template --template-stage Processed`.
