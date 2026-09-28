"use client";
import { useState, type ReactElement, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@aqarak/i18n";
import {
  House,
  Inbox,
  Users,
  Building2,
  UserRound,
  FileSignature,
  ShieldCheck,
  Wallet,
  Receipt,
  Wrench,
  Folder,
  ListChecks,
  LayoutDashboard,
  History,
  Settings,
  FileText,
  Sparkles,
  Download,
  KeyRound,
  Landmark,
  Banknote,
  FileSpreadsheet,
  TriangleAlert,
  ChartColumn,
  ChevronDown,
  Menu,
  MoreHorizontal,
  Globe,
} from "lucide-react";
import type { CompanyContext } from "@/lib/api/contract";
import { navigationFor, sections } from "@/lib/navigation/sections";
import { Link, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ThemeSwitch } from "@/components/system/theme-switch";
import { BrandMark } from "@/components/system/brand-mark";
import { LanguageSwitch } from "@/components/system/language-switch";
import { DemoBanner, OfflineBanner } from "@/components/system/screen-states";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DemoTag, capacityWords } from "./capacities";
import { SignOut } from "./sign-out";
const icons: Record<string, typeof House> = {
  House,
  Inbox,
  Users,
  Building2,
  UserRound,
  FileSignature,
  ShieldCheck,
  Wallet,
  Receipt,
  Wrench,
  Folder,
  ListChecks,
  LayoutDashboard,
  History,
  Settings,
  FileText,
  Sparkles,
  Download,
  KeyRound,
  Landmark,
  Banknote,
  FileSpreadsheet,
  TriangleAlert,
  ChartColumn,
};
interface ShellProps {
  locale: Locale;
  context: CompanyContext;
  contexts: CompanyContext[];
  displayName: string;
  mock: boolean;
  children: ReactNode;
}
export function AppShell({
  locale,
  context,
  contexts,
  displayName,
  mock,
  children,
}: ShellProps): ReactElement {
  const translate = useTranslations("Shell");
  const navigation = useTranslations("Navigation");
  const auth = useTranslations("Auth");
  const pathname = usePathname();
  const current = sections.find(
    (section) =>
      /\/companies\/[^/]+\/([^/]+)(?:\/|$)/.exec(pathname)?.[1] === section.id,
  );
  const [open, setOpen] = useState(false);
  const title = current
    ? navigation(`sections.${current.id}`)
    : translate("notFound");
  function sidebar(): ReactElement {
    return (
      <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                className="h-14 w-full justify-start rounded-none ps-4 pe-4 text-start"
              />
            }
            aria-label={translate("switchCompany")}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand text-brand-foreground">
              <Building2 className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label font-semibold">
                {context.companyName[locale]}
              </span>
              <span className="block truncate text-caption text-muted-foreground">
                {capacityWords(context, locale)}
              </span>
            </span>
            <ChevronDown aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {contexts
              .filter((item) => item.companyId !== context.companyId)
              .map((item) => (
                <DropdownMenuItem
                  key={item.companyId}
                  render={<Link href={`/companies/${item.companyId}/home`} />}
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  {item.companyName[locale]}
                </DropdownMenuItem>
              ))}
            <DropdownMenuItem render={<Link href="/companies" />}>
              {translate("allCompanies")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {context.isDemo && (
          <div className="ps-4 pe-4 pb-2">
            <DemoTag locale={locale} />
          </div>
        )}
        <nav
          aria-label={translate("navigation")}
          className="min-h-0 flex-1 overflow-y-auto ps-2 pe-2 py-2"
        >
          {navigationFor(context).map((section) => {
            const Icon = icons[section.icon] ?? House;
            const selected = current?.id === section.id;
            return (
              <Link
                key={section.id}
                href={`/companies/${context.companyId}/${section.id}`}
                onClick={() => {
                  setOpen(false);
                }}
                aria-current={selected ? "page" : undefined}
                className={`flex h-8 items-center gap-2 rounded-md ps-2 pe-2 text-label ${section.id === "co-worker" ? "mt-4" : ""} ${selected ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}
              >
                <Icon
                  aria-hidden="true"
                  className={`size-5 shrink-0 ${section.id === "co-worker" && !selected ? "text-ai-fg" : ""}`}
                />
                <span className="truncate">
                  {navigation(`sections.${section.id}`)}
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-4">
          <div className="flex items-center gap-2">
            <Avatar>
              <AvatarFallback>
                {displayName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((word) => word.slice(0, 1))
                  .join("")}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-label">{displayName}</p>
              <p className="flex items-center gap-1 text-caption text-muted-foreground">
                <Globe className="size-4" aria-hidden="true" />
                {translate("currentLanguage")}
              </p>
            </div>
          </div>
          <details className="relative mt-2">
            <summary className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md text-label">
              <MoreHorizontal className="size-5" aria-hidden="true" />
              {translate("more")}
            </summary>
            <div className="absolute bottom-full start-0 z-20 mb-2 w-64 space-y-4 rounded-md border bg-popover p-4 text-popover-foreground shadow-elevation-2">
              <ThemeSwitch />
              <LanguageSwitch href={pathname} />
              <SignOut />
            </div>
          </details>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-svh lg:ps-60">
      <aside
        data-testid="desktop-sidebar"
        className="fixed inset-y-0 start-0 hidden w-60 border-e lg:block"
      >
        {sidebar()}
      </aside>
      <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b bg-background ps-4 pe-4 lg:ps-8 lg:pe-8">
        <BrandMark locale={locale} />
        <div className="lg:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              render={<Button variant="ghost" size="icon" />}
              aria-label={translate("openNavigation")}
            >
              <Menu aria-hidden="true" />
            </SheetTrigger>
            <SheetContent side="start" className="gap-0 overflow-hidden">
              <SheetTitle className="sr-only">
                {translate("navigation")}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {context.companyName[locale]}
              </SheetDescription>
              {sidebar()}
            </SheetContent>
          </Sheet>
        </div>
        <nav
          aria-label={title}
          className="flex min-w-0 items-center gap-2 text-label"
        >
          <Link
            href={`/companies/${context.companyId}/home`}
            className="truncate text-muted-foreground"
          >
            {context.companyName[locale]}
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page" className="truncate">
            {title}
          </span>
        </nav>
      </header>
      <div className="space-y-2 ps-8 pe-8 pt-4">
        {context.isDemo && <DemoBanner />}
        {mock && (
          <p className="text-caption text-muted-foreground">
            {auth("mockNotice")}
          </p>
        )}
        <OfflineBanner />
      </div>
      <main id="main" tabIndex={-1} className="space-y-6 ps-8 pe-8 pt-6 pb-8">
        {children}
      </main>
    </div>
  );
}
