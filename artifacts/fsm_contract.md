# FSM Contract (STM32 Baseline)

## States
- IDLE
- NAVIGATE
- ALIGN_PICK
- ALIGN_DROP
- DECIDE
- ERROR_RECOVERY
- RETURN_HOME

## Transition Rules
1. IDLE -> NAVIGATE when start trigger is received.
2. NAVIGATE -> DECIDE when junction marker is detected.
3. DECIDE -> ALIGN_PICK for PICK_LOCK or PICK_RESOURCE actions.
4. DECIDE -> ALIGN_DROP for DROP_LOCK or DROP_RESOURCE actions.
5. ALIGN_PICK -> NAVIGATE after successful pickup; -> ERROR_RECOVERY on sensor timeout.
6. ALIGN_DROP -> NAVIGATE after successful placement; -> ERROR_RECOVERY on placement failure.
7. ERROR_RECOVERY -> NAVIGATE after line reacquisition.
8. DECIDE -> RETURN_HOME when all resources delivered or end-of-round policy guard is met.
9. RETURN_HOME -> IDLE when START node is reached and round terminates.

## Sensor Assumptions
- Multi-channel line array provides lateral error and junction event flags.
- Gripper presence sensor confirms lock/resource pickup.
- Color classification available during branch pickup and zone placement checks.
