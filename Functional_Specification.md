# Functional Specification -- Intelligent Multi-Agent Conversational System

## 1. Overview

This software implements a **multi-agent conversational framework**
powered by an **AI API**.\
It allows a user or another agent to launch and control intelligent
agents capable of autonomous reasoning, command execution, and
self-organization within a persistent conversational environment.

When launched in interactive mode, the system starts a **default agent**
--- effectively the same type of entity as any other agent. There is no
distinction between "main AI" and "agents"; every active entity is an
agent operating within a hierarchical session structure.

------------------------------------------------------------------------

## 2. Objectives

-   Enable natural-language interaction between user and AI agents.
-   Allow agents to execute local system commands safely.
-   Maintain persistent conversational and operational history.
-   Support hierarchical agent invocation: one agent can launch others.
-   Ensure controlled interruptions and graceful state recovery.
-   Optimize long-running conversations by compacting history via AI.

------------------------------------------------------------------------

## 3. Agents and Hierarchical Control

### 3.1 Agent identity

Each agent has: - A unique identifier. - A specific role prompt
(defining its behavior). - Its own conversation history and session
context.

### 3.2 Agent hierarchy

-   When an agent launches another agent, it becomes its **launcher**.\
-   The **launcher** always waits until the launched agent has completed
    its task before resuming execution.\
-   Each agent instance maintains its own conversational context but
    inherits certain parameters (working directory, API key, etc.) from
    its launcher.

### 3.3 Interactive context switching

-   When the application runs in **interactive mode**, the default agent
    takes control of the UI.\
-   If a new agent is launched (either by user or by another agent),
    **the UI focus switches** to the new agent.\
-   When that agent finishes or is stopped, control **returns to the
    launcher's level**.

### 3.4 Interruption control

-   A specific keyboard shortcut interrupts **only the currently active
    agent**, not its launcher or higher-level agents.\
-   The launcher resumes once the current agent is stopped or has
    completed.

### 3.5 Process model

-   All agents run **within the same process**.\
-   Spawning a new agent means creating a **new agent instance**, not a
    system process.\
-   The launcher remains in a suspended state until the child agent
    completes.

------------------------------------------------------------------------

## 4. Functional Features

### 4.1 Conversational interface

-   Accepts natural language input from user or parent agent.
-   Produces textual responses through the AI API.
-   Persists the dialogue in structured session storage.

### 4.2 Command execution

-   Agents can output actionable instructions marked with a special
    prefix (e.g., `>> command`).
-   Such instructions are validated, executed safely, and logged with
    success/failure states.
-   Forbidden commands are filtered to prevent destructive operations.

### 4.3 Session management

Each agent session contains: - Conversation history (messages and
responses), - Execution history (commands and outputs), - Session
metadata (ID, description, initial prompt), - Archival and restoration
capabilities.

Agents can: - Start new sessions, - Archive completed ones, - Switch to
or resume archived sessions.

### 4.4 Conversation compaction

When a session becomes too large: - The AI API is asked to **summarize
and condense** the conversation to about 20% of its original size. - If
the AI summary fails, a fallback truncation method is used.

### 4.5 Agent invocation

Agents can launch other agents by instruction such as:

    agent <id>: <message>

or interactively via a user command:

    /agent <id> "<message>"

The launcher pauses until the called agent completes its mission.

### 4.6 Interactive commands

  Command                     Function
  --------------------------- ---------------------------------------------
  `/help`                     Show available commands
  `/clear`                    Archive current session and start a new one
  `/clear-all`                Delete all sessions and archives
  `/compact`                  Force conversation compaction
  `/history`                  Show full command history
  `/status`                   Display current session status
  `/archives`                 List archived sessions
  `/continue`                 Resume last session
  `/continue <id>`            Load a specific archived session
  `/agent <id> "<message>"`   Launch another agent interactively
  `/forbidden`                List forbidden commands
  `/quit` or `/exit`          Exit the application

### 4.7 Interrupt handling

-   Pressing the **interrupt key** stops only the **current agent**.
-   Parent agents and the user interface remain active and ready to
    resume.

------------------------------------------------------------------------

## 5. Data Model

  Element                 Description
  ----------------------- ------------------------------------------------
  **Session**             Persistent conversational state for each agent
  **Archives**            Stored past sessions
  **History**             Log of executed commands and results
  **Agent definitions**   Configuration of agent roles and prompts
  **System log**          Execution and state trace

------------------------------------------------------------------------

## 6. AI API Integration

### 6.1 Purpose

Used for generating messages, summarizing sessions, and enabling
reasoning for all agents.

### 6.2 Exchange format

Each API call includes: - Ordered message history (`system`, `user`,
`assistant` roles), - Optional system prompt, - Model parameters
(temperature, token limit, timeout).

### 6.3 Error handling

-   Timeout and connection error detection,
-   Validation of returned content before use.

------------------------------------------------------------------------

## 7. Functional Constraints

-   All AI exchanges must be recorded.
-   No destructive system commands may be executed.
-   Agents must run concurrently within the same process space.
-   Interruptions must cleanly stop the affected agent only.
-   All data must remain consistent and recoverable after failure.

------------------------------------------------------------------------

## 8. System Flow Summary

1.  **Initialization**
    -   Load configuration and agents.\
    -   Start default agent in interactive mode.
2.  **Execution loop**
    -   Accept user or agent input.\
    -   Send to the active agent for interpretation.\
    -   Execute any generated commands or sub-agent invocations.\
    -   Update and persist session data.
3.  **Termination**
    -   Archive session if needed.\
    -   Release resources and exit cleanly.
