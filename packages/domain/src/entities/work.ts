import { z } from "zod";
import * as ids from "../ids";
import { localDate, utcInstant } from "../time";
import * as vocabulary from "../vocabulary";
import {
  language,
  standardFields,
  subjectId,
  subjectType,
  text,
} from "./shared";

/** Records a bounded note and its visibility on a business subject. */
export const noteRecord = z.strictObject({
  ...standardFields(ids.noteId),
  subjectType,
  subjectId,
  body: z.string().min(1).max(4000),
  visibility: vocabulary.noteVisibility,
});
/** Represents a stored business note. */
export type NoteRecord = z.infer<typeof noteRecord>;

/** Records an assigned task against a business subject. */
export const taskRecord = z.strictObject({
  ...standardFields(ids.taskId),
  subjectType,
  subjectId,
  title: text,
  assigneeAccountId: ids.personAccountId,
  dueAt: utcInstant.nullable(),
  status: vocabulary.taskStatus,
});
/** Represents a stored assigned task. */
export type TaskRecord = z.infer<typeof taskRecord>;

/** Records a scheduled reminder for one of the thirteen reminder rules. */
export const reminderRecord = z.strictObject({
  ...standardFields(ids.reminderId),
  subjectType,
  subjectId,
  ruleCode: z.enum([
    "n1",
    "n2",
    "n3",
    "n4",
    "n5",
    "n6",
    "n7",
    "n8",
    "n9",
    "n10",
    "n11",
    "n12",
    "n13",
  ]),
  recipientAccountId: ids.personAccountId,
  fireOn: localDate,
  status: vocabulary.reminderStatus,
});
/** Represents a stored scheduled reminder. */
export type ReminderRecord = z.infer<typeof reminderRecord>;

/** Records a notification with an optional complete subject reference. */
export const notificationRecord = z
  .strictObject({
    ...standardFields(ids.notificationId),
    recipientAccountId: ids.personAccountId,
    channel: vocabulary.notificationChannel,
    templateCode: text,
    language,
    subjectType: subjectType.nullable(),
    subjectId: subjectId.nullable(),
    status: vocabulary.notificationStatus,
    readAt: utcInstant.nullable(),
    dedupeKey: text,
  })
  .refine(
    (record) => (record.subjectType === null) === (record.subjectId === null),
    {
      message: "A notification subject requires both type and identifier",
      path: ["subjectId"],
    },
  );
/** Represents a stored notification. */
export type NotificationRecord = z.infer<typeof notificationRecord>;
