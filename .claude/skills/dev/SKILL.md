---
name: dev
description: dev-plan -> dev-plan-review -> dev-code -> dev-code-review -> dev-code-refactor 순차 실행
user-invocable: true
---
# /dev - 서브에이전트 순차 실행 워크플로우

## 개요
5개의 서브에이전트를 순서대로 실행하여 기획 → 기획 검토 → 구현 → 구현 검토 → 코드 리팩토링을 자동화한다.

## CRITICAL RULES

1. **순서 엄수**: 반드시 아래 순서대로 수행한다. 이전 단계가 완료되어야 다음 단계를 시작한다.
2. **TodoList 필수**: 시작 시 5단계를 모두 TaskCreate로 등록하고, 의존성(blockedBy)을 설정한다.
3. **Phase 상태 추적**: 각 단계 시작 시 TaskUpdate(in_progress), 완료 시 TaskUpdate(completed)를 호출한다.
4. **사용자 요구사항 확인**: 첫 시작 시 AskUserQuestion으로 구현할 내용을 확인한다.

---

## 워크플로우 시작 시 할 일

`/dev`가 호출되면 **반드시** 아래를 먼저 수행:

1. 사용자에게 구현하고 싶은 내용을 질문 (AskUserQuestion)
2. 아래 5단계를 TaskCreate로 등록:

```
Step 1: dev-plan (개발 계획 수립)
Step 2: dev-plan-review (계획서 검토)
Step 3: dev-code (계획 기반 코드 구현)
Step 4: dev-code-review (구현 결과 검증)
Step 5: dev-code-refactor (코드 리뷰 및 리팩토링)
```

3. Step 간 의존성(blockedBy) 설정: Step 2 → Step 1, Step 3 → Step 2, Step 4 → Step 3, Step 5 → Step 4

---

## Step 상세

### Step 1: dev-plan (개발 계획 수립)
- **서브에이전트**: `dev-plan`
- **역할**: 사용자 요구사항을 분석하고 개발 계획서를 작성한다
- **결과물**: `docs/dev-plan/` 폴더에 계획 문서 생성
- **완료 후**: 결과를 사용자에게 요약 보고

### Step 2: dev-plan-review (계획서 검토 및 자동 수정)
- **서브에이전트**: `dev-plan-review`
- **역할**: 계획서의 논리적 정합성, 모호한 표현, 불명확한 용어를 검토하고 **이슈 발견 시 직접 문서를 수정**한다
- **결과물**: 수정된 계획 문서 + 수정 내역 보고
- **완료 후**: 수정 내역을 사용자에게 보고하고 즉시 Step 3으로 진행

### Step 3: dev-code (계획 기반 코드 구현)
- **서브에이전트**: `dev-code`
- **역할**: 계획서를 기반으로 실제 코드를 구현한다
- **결과물**: 구현된 소스 코드
- **완료 후**: 구현 결과를 사용자에게 요약 보고

### Step 4: dev-code-review (구현 결과 검증)
- **서브에이전트**: `dev-code-review`
- **역할**: 계획서와 구현 코드를 비교하여 누락/불일치를 찾고 수정한다
- **결과물**: 검증 결과 및 코드 수정
- **완료 후**: 결과를 사용자에게 보고하고 즉시 Step 5로 진행

### Step 5: dev-code-refactor (코드 리뷰 및 리팩토링)
- **서브에이전트**: `dev-code-refactor`
- **역할**: 구현된 코드의 버그, 보안 취약점, 성능 문제, 코드 품질을 리뷰하고 직접 수정한다
- **결과물**: 리팩토링된 코드 + 리뷰 결과 보고
- **완료 후**: 최종 결과를 사용자에게 보고

---

## 워크플로우 완료

모든 Step이 completed 상태가 되면:
1. TaskList로 전체 상태 확인
2. 사용자에게 완료 보고 (각 단계 결과 요약)
3. 필요시 git commit 제안
