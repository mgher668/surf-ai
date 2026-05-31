import { type FormEvent } from "react";
import { type Locale, t } from "../../common/i18n";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";

interface RenameSessionDialogProps {
  locale: Locale;
  open: boolean;
  title: string;
  error: string | undefined;
  onOpenChange: (open: boolean) => void;
  onTitleChange: (title: string) => void;
  onSubmit: () => void | Promise<void>;
  onCancel: () => void;
}

export function RenameSessionDialog({
  locale,
  open,
  title,
  error,
  onOpenChange,
  onTitleChange,
  onSubmit,
  onCancel
}: RenameSessionDialogProps): JSX.Element {
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void onSubmit();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(locale, "renameSession")}</DialogTitle>
          <DialogDescription>{t(locale, "renameSessionDescription")}</DialogDescription>
        </DialogHeader>

        <form className="grid gap-3" onSubmit={handleSubmit}>
          <Input
            value={title}
            onChange={(event) => {
              onTitleChange(event.target.value);
            }}
            maxLength={120}
            autoFocus
          />
          {error ? (
            <div className="text-xs text-destructive">{error}</div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
            >
              {t(locale, "cancel")}
            </Button>
            <Button type="submit">{t(locale, "save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
