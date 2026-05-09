"use client";

import { toast } from "sonner";
import { api } from "~/trpc/react";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Building2, Users, FileText, FileDown, Flag } from "lucide-react";
import dayjs from "dayjs";
import { Button } from "~/components/ui/button";
import { FEATURE_FLAGS, type FeatureFlagKey } from "~/lib/feature-flags";

const moduleConfig: Record<string, { label: string; className: string }> = {
  RECEIVE: { label: "Receive", className: "bg-purple-100 text-purple-700 border-purple-300" },
  SEND: { label: "Send", className: "bg-blue-100 text-blue-700 border-blue-300" },
  BOTH: { label: "Both", className: "bg-green-100 text-green-700 border-green-300" },
};

const planConfig: Record<string, { label: string; className: string }> = {
  LOCKED: { label: "Locked", className: "bg-gray-100 text-gray-700 border-gray-300" },
  TRIAL: { label: "Trial", className: "bg-blue-100 text-blue-700 border-blue-300" },
  PAID: { label: "Paid", className: "bg-emerald-100 text-emerald-700 border-emerald-300" },
  EXPIRED: { label: "Expired", className: "bg-rose-100 text-rose-700 border-rose-300" },
};

export default function AdminPage() {
  const { data: companies, isLoading, refetch } = api.admin.listCompanies.useQuery();
  const { data: flags, refetch: refetchFlags } = api.featureFlag.getAll.useQuery();
  const utils = api.useUtils();

  const setModule = api.admin.setModule.useMutation({
    onSuccess: () => {
      toast.success("Module updated");
      void refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update module");
    },
  });

  const setSendingPlan = api.admin.setSendingPlan.useMutation({
    onSuccess: () => {
      toast.success("Plan updated");
      void refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update plan");
    },
  });

  const setFlag = api.featureFlag.set.useMutation({
    onSuccess: () => {
      toast.success("Feature flag updated");
      void refetchFlags();
      void utils.featureFlag.getAll.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update feature flag");
    },
  });

  const handleModuleChange = (companyId: string, value: string) => {
    const selectedModule = value === "none" ? null : (value as "RECEIVE" | "SEND" | "BOTH");
    setModule.mutate({ companyId, module: selectedModule });
  };

  const handlePlanChange = (companyId: string, value: string) => {
    setSendingPlan.mutate({
      companyId,
      plan: value as "LOCKED" | "TRIAL" | "PAID" | "EXPIRED",
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Manage companies and assign modules
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Companies</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{companies?.length ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Receive Module</CardTitle>
            <FileDown className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {companies?.filter((c) => c.module === "RECEIVE" || c.module === "BOTH").length ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Send Module</CardTitle>
            <FileText className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {companies?.filter((c) => c.module === "SEND" || c.module === "BOTH").length ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">No Module</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {companies?.filter((c) => !c.module).length ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Feature Flags */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Flag className="h-4 w-4" />
            Feature Flags
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]).map((key) => {
            const meta = FEATURE_FLAGS[key];
            const enabled = flags?.[key] ?? meta.defaultEnabled;
            return (
              <div key={key} className="flex items-start justify-between gap-4 rounded-md border p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{meta.label}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{meta.description}</p>
                </div>
                <Button
                  variant={enabled ? "default" : "outline"}
                  size="sm"
                  disabled={setFlag.isPending}
                  onClick={() => setFlag.mutate({ key, enabled: !enabled })}
                  className={enabled ? "bg-green-600 hover:bg-green-700" : ""}
                >
                  {enabled ? "Enabled" : "Disabled"}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Companies Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Send Plan</TableHead>
                  <TableHead className="text-center">Customers</TableHead>
                  <TableHead className="text-center">Sent</TableHead>
                  <TableHead className="text-center">Received</TableHead>
                  <TableHead>Onboarded</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(!companies || companies.length === 0) ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                      No companies yet
                    </TableCell>
                  </TableRow>
                ) : (
                  companies.map((company) => (
                    <TableRow key={company.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{company.name}</p>
                          {company.email && (
                            <p className="text-xs text-muted-foreground">{company.email}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          {company.users.map((u) => (
                            <p key={u.id} className="text-xs text-muted-foreground">
                              {u.name ?? u.email}
                            </p>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={company.module ?? "none"}
                          onValueChange={(val) => handleModuleChange(company.id, val)}
                        >
                          <SelectTrigger className="h-8 w-[120px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">
                              <span className="text-muted-foreground">None</span>
                            </SelectItem>
                            <SelectItem value="RECEIVE">
                              <Badge variant="outline" className={moduleConfig.RECEIVE.className}>
                                Receive
                              </Badge>
                            </SelectItem>
                            <SelectItem value="SEND">
                              <Badge variant="outline" className={moduleConfig.SEND.className}>
                                Send
                              </Badge>
                            </SelectItem>
                            <SelectItem value="BOTH">
                              <Badge variant="outline" className={moduleConfig.BOTH.className}>
                                Both
                              </Badge>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <Select
                            value={company.sendingPlan}
                            onValueChange={(val) => handlePlanChange(company.id, val)}
                          >
                            <SelectTrigger className="h-8 w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(["LOCKED", "TRIAL", "PAID", "EXPIRED"] as const).map((p) => (
                                <SelectItem key={p} value={p}>
                                  <Badge variant="outline" className={planConfig[p].className}>
                                    {planConfig[p].label}
                                  </Badge>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {company.trialEndsAt && company.sendingPlan === "TRIAL" && (
                            <p className="text-[11px] text-muted-foreground">
                              Ends {dayjs(company.trialEndsAt).format("MMM D")}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">{company._count.customers}</TableCell>
                      <TableCell className="text-center">{company._count.sentInvoices}</TableCell>
                      <TableCell className="text-center">{company._count.receivedInvoices}</TableCell>
                      <TableCell>
                        <Badge variant={company.onboarded ? "default" : "outline"}>
                          {company.onboarded ? "Yes" : "No"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {dayjs(company.createdAt).format("MMM D, YYYY")}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
