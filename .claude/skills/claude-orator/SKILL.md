---
name: claude-orator
description: Use when dispatching subagents with non-trivial prompts, writing system prompts or skill descriptions, or when any prompt feels vague — scores 7 quality dimensions, auto-selects from 11 techniques, and rewrites with before/after scores.
---

# Claude Orator

Make prompts measurably better before sending them.

## When to Use

**Dispatching subagents** → Run the prompt through `orator_optimize` first. Better prompt = less back-and-forth, more accurate results.

**Writing system prompts** → SKILL.md files, agent instructions, tool descriptions. Small improvements compound over many invocations.

**Prompt feels vague or under-specified** → Score it. Orator identifies weak dimensions and applies targeted techniques.

## Quick Reference

```
orator_optimize(prompt: "...", intent?: "code|analysis|creative|extraction|system", techniques?: ["xml-tags", "few-shot"])
```

**Output:** Before score → techniques applied → optimized prompt → after score.

**Already good?** One-line confirmation: `🪶 ━━ already well-structured (8.4)`

## When to Skip

Skip for trivial prompts, simple questions, or prompts already scoring above 7.0. The overhead isn't worth it for single-step instructions.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Optimizing everything | Focus on high-leverage: subagent prompts, system prompts |
| Ignoring the score delta | Close before/after scores mean the prompt was already good |
| Not using `techniques` override | When you know which techniques apply, force them |
