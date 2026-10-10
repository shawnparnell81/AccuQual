import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { BEGIN_EDIT_ERROR, postBeginEdit } from "../lib/beginEdit";
import { afterEditClick, afterSaveOrCancel, isFreshFormOpen, openSavedForm, savedFieldsEditable, type SavedFormMode } from "../lib/savedFormLock";

/**
 * A brand-new blank opens editable. Every later open of that record is locked
 * until Edit. Save keeps the session editable. Done, Cancel, navigation, and
 * reload lock it again.
 */
export function useSavedFormMode(recordId: number | string | undefined, canEdit: boolean) {
  const location = useLocation();
  const freshOnArrival = useRef(isFreshFormOpen(location.state));
  const lockedByUser = useRef(false);
  const id = String(recordId ?? "");
  const [mode, setMode] = useState<SavedFormMode>(() => openSavedForm(freshOnArrival.current && canEdit));

  useEffect(() => {
    freshOnArrival.current = isFreshFormOpen(location.state);
    lockedByUser.current = false;
    setMode(openSavedForm(freshOnArrival.current && canEdit));
  }, [id]);

  useEffect(() => {
    if (!canEdit) {
      setMode("locked");
      return;
    }
    if (freshOnArrival.current && !lockedByUser.current) setMode("editing");
  }, [canEdit, id]);

  function lock() {
    lockedByUser.current = true;
    freshOnArrival.current = false;
    setMode(afterSaveOrCancel());
  }

  function unlock() {
    if (!canEdit) return;
    lockedByUser.current = false;
    freshOnArrival.current = false;
    setMode(afterEditClick(true));
  }

  return {
    mode,
    fieldsEditable: savedFieldsEditable(mode, canEdit),
    openedFresh: freshOnArrival.current,
    lock,
    unlock,
  };
}

/** Unlock writes the edit-started history line, then the fields open. A second click while that is running does nothing. */
export function useModuleFormLock(recordId: number, canEdit: boolean, beginPath: string) {
  const session = useSavedFormMode(recordId, canEdit);
  const queryClient = useQueryClient();
  const openingRef = useRef(false);
  const [opening, setOpening] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  async function onEdit() {
    if (!canEdit || openingRef.current || session.mode === "editing") return;
    openingRef.current = true;
    setOpening(true);
    setEditError(null);
    try {
      await postBeginEdit(beginPath);
      session.unlock();
      void queryClient.invalidateQueries({ queryKey: ["workflow-history"] });
    } catch {
      setEditError(BEGIN_EDIT_ERROR);
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  }
  return { ...session, onEdit, opening, editError };
}
