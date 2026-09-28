"use client";
import { useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@aqarak/i18n";
import { Search, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ShowcaseShell, ShowcaseSection } from "./showcase-shell";
import { TokenSwatches } from "./token-swatches";
import { FieldError } from "./screen-states";
import { MoneyAmount, DateText, IdentifierText } from "./formatted-values";
import { StatusTag } from "./status-tag";

const typeSamples = [
  ["display", "text-display"],
  ["h1", "text-h1"],
  ["h2", "text-h2"],
  ["h3", "text-h3"],
  ["body", "text-body"],
  ["body-dense", "text-body-dense"],
  ["body-strong", "text-body-strong"],
  ["label", "text-label"],
  ["caption", "text-caption"],
  ["caption-strong", "text-caption-strong"],
  ["mono", "font-mono text-mono"],
] as const;
export function FoundationsShowcase({
  locale,
}: {
  locale: Locale;
}): ReactElement {
  const translate = useTranslations("Showcase");
  const common = useTranslations("Common");
  const [lastAction, setLastAction] = useState("");
  return (
    <ShowcaseShell>
      <ShowcaseSection title={translate("colours")}>
        <TokenSwatches />
      </ShowcaseSection>
      <ShowcaseSection title={translate("statusTones")}>
        <div className="flex flex-wrap gap-4">
          <StatusTag entity="unit" state="vacant" />
          <StatusTag entity="unit" state="reserved" />
          <StatusTag entity="unit" state="listed" />
          <StatusTag entity="unit" state="occupied" />
          <StatusTag entity="unit" state="blocked" />
          <StatusTag entity="contract" state="ended" />
        </div>
      </ShowcaseSection>
      <ShowcaseSection title={translate("type")}>
        <dl className="space-y-6">
          {typeSamples.map(([token, className]) => (
            <div
              key={token}
              className="grid items-baseline gap-2 sm:grid-cols-[10rem_1fr]"
            >
              <dt className="font-mono text-mono">
                <bdi dir="ltr">{token}</bdi>
              </dt>
              <dd
                className={className}
                data-body-sample={token === "body" ? "true" : undefined}
              >
                {translate("typeSample")}
              </dd>
            </div>
          ))}
        </dl>
      </ShowcaseSection>
      <ShowcaseSection title={translate("space")}>
        <div className="flex flex-wrap items-end gap-8">
          {[
            ["8", "w-2"],
            ["16", "w-4"],
            ["24", "w-6"],
            ["32", "w-8"],
          ].map(([label, width]) => (
            <div key={label} className="space-y-2">
              <div className={`h-8 bg-brand ${width ?? ""}`} />
              <p className="text-caption tabular-nums">{label}</p>
            </div>
          ))}
          {[
            ["sm · 4", "rounded-sm"],
            ["md · 8", "rounded-md"],
            ["lg · 12", "rounded-lg"],
            ["full", "rounded-full"],
          ].map(([label, radius]) => (
            <div
              key={label}
              className={`border bg-secondary p-4 font-mono text-mono ${radius ?? ""}`}
            >
              <bdi dir="ltr">{label}</bdi>
            </div>
          ))}
        </div>
      </ShowcaseSection>
      <ShowcaseSection title={translate("buttons")}>
        <div className="flex flex-wrap gap-2">
          {(
            [
              "default",
              "secondary",
              "outline",
              "ghost",
              "destructive",
              "link",
            ] as const
          ).map((variant) => (
            <Button
              key={variant}
              variant={variant}
              onClick={() => {
                setLastAction(translate(variant));
              }}
            >
              {translate(variant)}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["sm", "default", "lg"] as const).map((size) => (
            <Button
              key={size}
              size={size}
              variant="outline"
              onClick={() => {
                setLastAction(translate(size === "default" ? "regular" : size));
              }}
            >
              {translate(size === "default" ? "regular" : size)}
            </Button>
          ))}
          <Button
            variant="outline"
            size="icon"
            aria-label={common("search")}
            onClick={() => document.getElementById("sample-owner")?.focus()}
          >
            <Search aria-hidden="true" />
          </Button>
        </div>
        <p role="status" className="min-h-6 text-caption">
          {lastAction}
        </p>
      </ShowcaseSection>
      <ShowcaseSection title={translate("controls")}>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sample-owner">{common("owner")}</Label>
              <Input
                id="sample-owner"
                aria-describedby="sample-owner-hint sample-owner-error"
                aria-invalid="true"
              />
              <p
                id="sample-owner-hint"
                className="text-caption text-muted-foreground"
              >
                {common("nameHint")}
              </p>
              <FieldError
                id="sample-owner-error"
                message={common("nameError")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sample-notes">{common("notes")}</Label>
              <Textarea
                id="sample-notes"
                aria-describedby="sample-notes-hint"
              />
              <p
                id="sample-notes-hint"
                className="text-caption text-muted-foreground"
              >
                {common("notesHint")}
              </p>
            </div>
            <Label className="flex items-center gap-2">
              <Checkbox />
              {translate("accept")}
            </Label>
          </div>
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-label">{translate("choice")}</legend>
              <RadioGroup defaultValue="email" aria-label={translate("choice")}>
                <Label className="flex items-center gap-2">
                  <RadioGroupItem value="email" />
                  {translate("email")}
                </Label>
                <Label className="flex items-center gap-2">
                  <RadioGroupItem value="phone" />
                  {translate("phone")}
                </Label>
              </RadioGroup>
            </fieldset>
            <div className="space-y-2">
              <Label htmlFor="sample-unit">{common("unit")}</Label>
              <Select defaultValue="104">
                <SelectTrigger id="sample-unit" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="104">104</SelectItem>
                  <SelectItem value="105">105</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </ShowcaseSection>
      <ShowcaseSection title={translate("formats")}>
        <Card>
          <CardHeader>
            <CardTitle>{common("company")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6">
            <p>{common("ownerName")}</p>
            <p>
              {common("unit")} <bdi className="tabular-nums">104</bdi>
            </p>
            <MoneyAmount fils={8_500_000} locale={locale} />
            <DateText iso="2026-09-28" locale={locale} />
            <IdentifierText value="784-1978-4829163-5" kind="emirates_id" />
            <IdentifierText
              value="784-1978-4829163-5"
              kind="emirates_id"
              masked
            />
          </CardContent>
        </Card>
      </ShowcaseSection>
      <ShowcaseSection title={translate("primitives")}>
        <div className="flex flex-wrap items-center gap-4">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>
              {translate("dialog")}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{translate("details")}</DialogTitle>
                <DialogDescription>
                  {translate("panelDescription")}
                </DialogDescription>
              </DialogHeader>
              <p>{common("company")}</p>
            </DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>
              {translate("sheet")}
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>{translate("details")}</SheetTitle>
                <SheetDescription>
                  {translate("panelDescription")}
                </SheetDescription>
              </SheetHeader>
              <p className="ps-6 pe-6">{common("company")}</p>
            </SheetContent>
          </Sheet>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              {translate("menu")}
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => {
                  setLastAction(translate("details"));
                }}
              >
                {translate("details")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" />}>
                {translate("tooltip")}
              </TooltipTrigger>
              <TooltipContent>{translate("panelDescription")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Avatar>
            <AvatarFallback>{common("ownerInitials")}</AvatarFallback>
          </Avatar>
        </div>
        <Separator />
        <Tabs defaultValue="details">
          <TabsList aria-label={translate("details")}>
            <TabsTrigger value="details">{translate("details")}</TabsTrigger>
            <TabsTrigger value="activity">{translate("activity")}</TabsTrigger>
          </TabsList>
          <TabsContent value="details">{common("company")}</TabsContent>
          <TabsContent value="activity">
            <DateText
              iso="2026-09-28"
              locale={locale}
              relativeTo="2026-09-30"
            />
          </TabsContent>
        </Tabs>
        <Alert>
          <CircleCheck aria-hidden="true" />
          <AlertDescription>{translate("alert")}</AlertDescription>
        </Alert>
      </ShowcaseSection>
    </ShowcaseShell>
  );
}
