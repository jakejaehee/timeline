# Backend Engineering Team Multi-Project Scheduling App - Requirements

## 1. Product Goal
This application helps backend engineering managers manage multiple projects simultaneously by providing:
- Project progress visibility
- Assignee workload and execution order
- Task dependencies
- Resource-constrained scheduling
- Gantt chart visualization
- Warning and risk detection

Core principle:
**Strict resource-constrained scheduling based on assignee availability and execution order**

---

## 2. Core Principles

### 2.1 Relationships
- A project has multiple tasks
- An assignee can participate in multiple projects
- An assignee can have multiple tasks
- Tasks must have an execution order per assignee

### 2.2 Concurrency Rule
- An assignee cannot work on multiple tasks at the same time
- Exception: If tasks are fractional (e.g., 0.5 MD), sequential execution within the same day is allowed

---

## 3. MD and Capacity

### 3.1 MD Definition
- Decimal up to 1 digit
- 1.0 MD = 1 working day
- 0.5 MD = half day
- End time is exclusive

### 3.2 Assignee Capacity
- Daily capacity <= 1.0
- Actual duration = MD / capacity

Example:
- 1.0 MD / 0.5 capacity = 2 days

---

## 4. Availability
Non-working days include:
- National holidays
- Company holidays
- Personal time off

---

## 5. Task Ordering

### 5.1 Ordering Concept
- Task order = execution queue per assignee

### 5.2 Unordered Tasks
- Allowed temporarily
- Must trigger continuous warning
- Must be visually marked

### 5.3 First Task Rule
- First task per assignee must have a start date

### 5.4 Ordering UX
- Drag & drop
- Per-assignee queue management

---

## 6. Scheduling Rules

### 6.1 Start Date
- Nullable except first task

### 6.2 Display
- Show calculated start/end dates only

### 6.3 Dependency Rule
- If predecessor constraint is stronger, it overrides user input

### 6.4 Start Calculation
actual_start = max(
- previous task end
- all predecessors end
- first task anchor date
- availability constraints
)

### 6.5 Same Day Rule
- If predecessor ends on full day → next task starts next day
- If predecessor ends fractional → next task can start same day

---

## 7. Dependencies

- Multiple predecessors allowed
- Rule: ALL predecessors finished

### Hold / Cancelled
- Dependencies are removed (ignored in scheduling)

---

## 8. Task Attributes

### Status
- To do
- In Progress
- Done
- Hold
- Cancelled

### Priority
- P0, P1, P2, P3

### Type
- Feature
- Design
- Backend
- Infra
- QA
- Release
- Ops
- Tech Debt

### Done Tasks
- Actual end date must be manually input

---

## 9. Project Attributes
- Name
- Deadline
- Status
- Members
- Tasks
- Expected end date
- Delay flag

---

## 10. Views

### Sorting Modes
1. Project > Task > Assignee
2. Project > Assignee > Task
3. Assignee > Project > Task

### Rule
- Viewing and editing (ordering) must be separated

---

## 11. Gantt Chart

- Weekly view
- Monday–Friday only
- Non-working days excluded

### Features
- Today marker
- Collapsible hierarchy
- Dependency arrows
- Status visualization
- Deadline marker

### Fractional MD
- Prefer proportional bar
- Fallback: full-day rendering

---

## 12. Warning System

Must detect:
- Unordered tasks
- Missing first task start date
- Schedule conflicts
- Dependency violations
- Deadline risks
- Orphan tasks
- Dependency removed due to Hold/Cancelled
- Availability conflicts

---

## 13. Filters

- Project
- Assignee
- Status
- Priority
- Type
- Warning
- Delayed tasks
- Date range
- Unordered tasks

---

## 14. Baseline

- Save snapshot
- Compare changes
- Track delays
- Track order changes

---

## 15. Summary

This system is:
- Resource-constrained
- Assignee-centric
- Order-driven scheduling system
- With strict concurrency rules
- And dynamic dependency resolution
