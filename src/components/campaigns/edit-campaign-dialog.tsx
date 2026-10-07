"use client";

import { useState } from "react";
import { formatBudget, titleCase } from "@/lib/format";
import { editCampaignAction } from "@/server/actions/tiktok";
import type { CampaignRow } from "@/server/dto";
import { Dialog } from "../ui/dialog";
import { Button, ErrorBanner, Field } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { BudgetEditor } from "./budget-editor";

/**
 * Edits the campaign fields TikTok allows to change after creation: name and budget.
 * Shows the exact changes for confirmation before anything is sent.
 */
export function EditCampaignDialog({
  campaign,
  advertiserId,
  currency,
  onClose,
  onSaved,
}: {
  campaign: CampaignRow;
  advertiserId: string;
  currency: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(campaign.name);
  const [budget, setBudget] = useState(campaign.budget !== null ? String(campaign.budget) : "");
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCampaignBudget = !!campaign.budgetMode && campaign.budgetMode !== "BUDGET_MODE_INFINITE";
  const newBudget = budget.trim() === "" ? null : Number(budget);
  const nameChanged = name.trim() !== campaign.name;
  const budgetChanged = hasCampaignBudget && newBudget !== null && newBudget !== campaign.budget;

  const budgetError =
    budgetChanged && (!Number.isFinite(newBudget) || (newBudget as number) <= 0) ? "Budget must be a number greater than 0." : null;
  const nameError = name.trim() === "" ? "Campaign name cannot be empty." : name.trim().length > 512 ? "At most 512 characters." : null;
  const canContinue = (nameChanged || budgetChanged) && !budgetError && !nameError;

  async function save() {
    setSaving(true);
    setError(null);
    const result = await editCampaignAction(advertiserId, campaign.id, {
      ...(nameChanged ? { name: name.trim() } : {}),
      ...(budgetChanged ? { budget: newBudget as number } : {}),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(result.data.message);
    onSaved();
  }

  return (
    <Dialog
      open
      wide
      title={review ? "Review changes" : "Edit campaign"}
      onClose={onClose}
      footer={
        review ? (
          <>
            <Button onClick={() => setReview(false)} disabled={saving}>
              Back
            </Button>
            <Button variant="primary" onClick={save} loading={saving}>
              Save Changes
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!canContinue} onClick={() => setReview(true)}>
              Review changes
            </Button>
          </>
        )
      }
    >
      {review ? (
        <div className="space-y-3">
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <p>These changes will be sent to TikTok:</p>
          <dl className="space-y-3">
            {nameChanged && (
              <div>
                <dt className="label">Name</dt>
                <dd>
                  <span className="text-slate-500 line-through">{campaign.name}</span> → <span className="font-medium text-slate-900">{name.trim()}</span>
                </dd>
              </div>
            )}
            {budgetChanged && (
              <div>
                <dt className="label">Budget</dt>
                <dd>
                  <span className="text-slate-500 line-through">{formatBudget(campaign.budget, campaign.budgetMode, currency)}</span> →{" "}
                  <span className="font-medium text-slate-900">{formatBudget(newBudget, campaign.budgetMode, currency)}</span>
                </dd>
              </div>
            )}
          </dl>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Campaign name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={512} />
          </Field>
          {nameError && <p className="-mt-2 text-xs text-red-600">{nameError}</p>}
          <BudgetEditor
            level="campaign"
            mode={campaign.budgetMode}
            current={campaign.budget}
            currency={currency}
            value={budget}
            onChange={setBudget}
            error={budgetError}
            lockedReason={
              hasCampaignBudget
                ? null
                : "This campaign has no campaign-level budget. Its budgets are set on each ad group; open the campaign to edit them."
            }
          />
          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-medium text-slate-700">Fixed after creation on TikTok</p>
            <p className="mt-1">
              Objective: {titleCase(campaign.objective)} · Budget type · Campaign budget optimization:{" "}
              {campaign.budgetOptimizeOn === null ? "Not available" : campaign.budgetOptimizeOn ? "On" : "Off"}
            </p>
            <p className="mt-1">Status is changed with Pause and Resume.</p>
          </div>
        </div>
      )}
    </Dialog>
  );
}
