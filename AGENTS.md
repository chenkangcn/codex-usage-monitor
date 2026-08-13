# AI Agent Guide

## ECS Deployment Authorization Gate

- Never deploy or release any modification to Alibaba Cloud ECS unless the user gives an explicit deployment or release instruction for the exact project and candidate in the current conversation.
- A bug report, fix request, implementation approval, completed AI verification, passing tests or builds, commit, push, pull request, read-only production investigation, or SSH approval does not authorize deployment.
- Without that explicit instruction, stop after the normal code-verification and GitHub-publication steps, hand the candidate back to the user for their own testing, and wait. Do not treat AI-run checks as the user's acceptance test.
- Even after the user reports that their testing passed, do not deploy until they explicitly instruct deployment. If they explicitly instruct deployment, re-verify the exact target, commit, checks, rollback path, and repository-specific deployment source of truth before changing ECS.

## AI Completion and Publication Rules

<!-- ai-completion-and-publication-rules:v1 -->

- Local runtime ownership: the user owns long-running local services and starts them in their own Terminal so logs remain visible. An AI agent may start a service only for a scoped debugging or verification step. Before handoff, it must stop every dev server, worker, scheduler, watcher, tunnel, database service, or other long-running process it started. Never leave AI-started background processes running. Do not stop user-started processes unless the task requires it and the user authorizes it.
- Default GitHub publication: after code changes are complete and relevant verification passes, stage only the task-related changes, create an intentional commit, and push to GitHub immediately, following the repository's branch and pull-request conventions. Treat this as the default authorized completion step. Skip committing or pushing only when the user explicitly says the current task must remain uncommitted or unpushed, or when publication is blocked by authentication, a missing remote, failed checks, conflicts, or unrelated worktree changes; report the blocker clearly.
- Publication safety: inspect the final diff before staging, never include secrets or unrelated user changes, and report the branch, commit, push result, pull request when applicable, and verification results in the handoff.
