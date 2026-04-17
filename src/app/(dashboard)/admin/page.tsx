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
import { Building2, Users, FileText, FileDown } from "lucide-react";
import dayjs from "dayjs";

const moduleConfig: Record<string, { label: string; className: string }> = {
  RECEIVE: { label: "Receive", className: "bg-purple-100 text-purple-700 border-purple-300" },
  SEND: { label: "Send", className: "bg-blue-100 text-blue-700 border-blue-300" },
  BOTH: { label: "Both", className: "bg-green-100 text-green-700 border-green-300" },
};

export default function AdminPage() {
  const { data: companies, isLoading, refetch } = api.admin.listCompanies.useQuery();

  const setModule = api.admin.setModule.useMutation({
    onSuccess: () => {
      toast.success("Module updated");
      void refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update module");
    },
  });

  const handleModuleChange = (companyId: string, value: string) => {
    const selectedModule = value === "none" ? null : (value as "RECEIVE" | "SEND" | "BOTH");
    setModule.mutate({ companyId, module: selectedModule });
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
      <div className="grid gap-4 sm:grid-cols-4">
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

      {/* Companies Table */}
      <Card>
        <CardContent className="p-0">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>Module</TableHead>
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
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
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
