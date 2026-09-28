alter table lease.contract_template no force row level security;
--> statement-breakpoint
alter table lease.clause no force row level security;
--> statement-breakpoint
insert into lease.contract_template
(company_id, code, template_version, name_en, name_ar, body_en, body_ar)
values (null, 'standard_residential', 1, 'Residential tenancy contract', 'عقد إيجار سكني',
$en$1. Parties
Contract {{contract_no}} records the residential tenancy between {{owner_name}} as owner and {{tenant_name}} as tenant, administered by {{company_name}}.

2. Premises
The rented premises are {{unit_label}} in Abu Dhabi. The parties record the condition of the premises at handover.

3. Term
The tenancy starts on {{term_start}} and ends on {{term_end}}. The agreed grace period is {{grace_days}} days.

4. Rent and payment
The annual rent is {{annual_rent}}. Payment is made in {{instalment_count}} instalments on the dates and for the amounts in the agreed payment schedule.

5. Security deposit
The security deposit is {{deposit}}. The parties record any agreed deductions and the balance due when the premises are returned.

6. Use and occupancy
The tenant uses the premises for residential purposes and follows the agreed occupancy conditions and applicable building rules.

7. Maintenance
The tenant reports maintenance needs promptly. The parties arrange maintenance according to their agreed responsibilities and record completed work.

8. Renewal and notice
The parties communicate renewal intentions and notices in writing, following the contract terms and applicable requirements.

9. Tawtheeq registration
The parties provide the information and documents needed to register this contract on the Tawtheeq system. The registration status is recorded separately.

10. Governing law
This tenancy is governed by the applicable laws of Abu Dhabi, including Abu Dhabi Law No. 20 of 2006.$en$,
$ar$1. الأطراف
يثبت العقد {{contract_no}} العلاقة الإيجارية السكنية بين {{owner_name}} بصفته المالك و{{tenant_name}} بصفته المستأجر، بإدارة {{company_name}}.

2. العين المؤجرة
العين المؤجرة هي {{unit_label}} في أبوظبي. يسجل الطرفان حالة العين عند التسليم.

3. المدة
تبدأ مدة الإيجار في {{term_start}} وتنتهي في {{term_end}}. مدة السماح المتفق عليها هي {{grace_days}} يوماً.

4. الأجرة والسداد
الأجرة السنوية هي {{annual_rent}}. تسدد على {{instalment_count}} دفعات في المواعيد وبالمبالغ الواردة في جدول السداد المتفق عليه.

5. مبلغ التأمين
مبلغ التأمين هو {{deposit}}. يسجل الطرفان أي استقطاعات متفق عليها والرصيد المستحق عند إعادة العين المؤجرة.

6. الاستخدام والإشغال
يستخدم المستأجر العين للأغراض السكنية ويلتزم بشروط الإشغال المتفق عليها وقواعد المبنى المعمول بها.

7. الصيانة
يبلغ المستأجر عن احتياجات الصيانة دون تأخير. يرتب الطرفان أعمال الصيانة وفق مسؤولياتهما المتفق عليها ويسجلان الأعمال المنجزة.

8. التجديد والإخطار
يتواصل الطرفان كتابة بشأن نية التجديد والإخطارات وفق شروط العقد والمتطلبات المعمول بها.

9. التسجيل في نظام توثيق
يقدم الطرفان المعلومات والمستندات اللازمة لتسجيل العقد في نظام توثيق. تسجل حالة التسجيل بشكل مستقل.

10. القانون الحاكم
تخضع العلاقة الإيجارية للقوانين المعمول بها في أبوظبي، بما فيها قانون أبوظبي رقم 20 لسنة 2006.$ar$);
--> statement-breakpoint
insert into lease.clause(company_id, clause_key, text_en, text_ar) values
(null, 'handover_inventory', 'The parties record keys, access cards and supplied items in the handover inventory.', 'يسجل الطرفان المفاتيح وبطاقات الدخول والمحتويات المسلمة في قائمة التسليم.'),
(null, 'maintenance_access', 'The parties agree a suitable appointment before routine maintenance access.', 'يتفق الطرفان على موعد مناسب للدخول لأعمال الصيانة الدورية.'),
(null, 'utilities', 'The parties record responsibility for utility accounts and final meter readings at handover.', 'يسجل الطرفان مسؤولية حسابات الخدمات وقراءات العدادات النهائية عند التسليم.'),
(null, 'alterations', 'The tenant obtains written agreement before making alterations to the premises.', 'يحصل المستأجر على موافقة مكتوبة قبل إجراء تعديلات على العين المؤجرة.'),
(null, 'written_notices', 'The parties keep a copy of written notices and record the date of delivery.', 'يحتفظ الطرفان بنسخة من الإخطارات المكتوبة ويسجلان تاريخ تسليمها.');
--> statement-breakpoint
alter table lease.clause force row level security;
--> statement-breakpoint
alter table lease.contract_template force row level security;
