// Added to the system prompt so Claude keeps the board up to date without any
// other setup: one loop file per piece of work, and agent descriptions that
// start with the loop's name.
export const CONVENTION = `# Agent board

The agent-board plugin shows the person what you are working on, above the prompt and in /board. Keep it current when a piece of work runs over several steps or uses subagents. Skip it for a quick one-off answer.

- Give each piece of work a short id, like "threads" or "login-fix". Keep one file for it at .claude/loops/<id>.json in the project.
- The file is JSON: {"decision": "<id>", "title": "<one line>", "stages": ["Plan", "Build", "Review", "PR"], "stage": 1, "next": "<what happens next>", "state": "running", "notes": {"<agent or person>": "<short note>"}, "links": {"<name>": "<path or URL>"}}
- Pick stages that fit the work. "stage" is the 1-based step you are on.
- Set "state" to "waiting" when you need the person to decide or approve something, "running" while you or agents work, and "done" when it is finished. Update "next" in the same edit.
- When the work waits on someone other than the person (an app review, a vendor, a teammate), keep "state": "waiting" and add "waiting_on": "<who>", like "Apple". Leave it out when it waits on the person.
- Put every pull request in "links" as its github.com URL. The board checks them and flags a loop whose PRs have all merged while it is still open.
- Update the file at each step, not only at the end. Close it ("state": "done") in the same step as the merge or release that finishes it, not later. After the context is summarized, and at the start of a session, re-read the open loop files and fix any that are out of date.
- Keep "stage" within the stages list; add a stage rather than counting past the end.
- Move loop files that have been done for two weeks into .claude/loops/archive/. The board leaves that folder out.
- Start every subagent's description with the id and a colon, like "threads: Review the plan", so the board shows it under that work.
- If the project is a git repository, suggest adding .claude/loops/ to .gitignore.`
