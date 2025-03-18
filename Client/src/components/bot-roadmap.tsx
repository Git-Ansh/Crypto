import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface BotRoadmapItem {
  _id: string;
  date: string;
  plan: string;
  completed: boolean;
}

interface BotRoadmapProps {
  roadmap: BotRoadmapItem[];
  loading?: boolean;
  onUpdate?: () => Promise<void>;
}

export function BotRoadmap({ roadmap, loading }: BotRoadmapProps) {
  return (
    <Card>
      <CardHeader className="p-3 sm:p-4 pb-0">
        <CardTitle className="text-base sm:text-lg">Bot Roadmap</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs whitespace-nowrap">
                  Date
                </TableHead>
                <TableHead className="text-xs">Plan</TableHead>
                <TableHead className="text-xs w-16 text-right">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-xs py-2">
                    Loading roadmap...
                  </TableCell>
                </TableRow>
              ) : roadmap.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-xs py-2">
                    No upcoming actions
                  </TableCell>
                </TableRow>
              ) : (
                roadmap.map((action) => (
                  <TableRow key={action._id}>
                    <TableCell className="text-xs py-2">
                      {action.date}
                    </TableCell>
                    <TableCell className="text-xs py-2">
                      {action.plan}
                    </TableCell>
                    <TableCell className="text-xs py-2 text-right">
                      {action.completed ? (
                        <div className="flex items-center justify-end">
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          Pending
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
