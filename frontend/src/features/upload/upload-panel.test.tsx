import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";
import { makeItem, renderWithQuery } from "@/test/render";
import { UploadPanel } from "./upload-panel";

const uploadItem = vi.hoisted(() => vi.fn());
vi.mock("@/services/items", () => ({ uploadItem }));

function addFiles(...files: File[]) {
  fireEvent.change(screen.getByTestId("file-input"), { target: { files } });
}

const jpeg = (name = "look.jpg") => new File([new Uint8Array(10)], name, { type: "image/jpeg" });

beforeEach(() => {
  uploadItem.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

describe("UploadPanel", () => {
  it("uploads with the chosen type and links to the new item", async () => {
    const item = makeItem({ type: "fabric" });
    uploadItem.mockResolvedValue(item);
    renderWithQuery(<UploadPanel />);

    fireEvent.click(screen.getByRole("radio", { name: "Fabric swatch" }));
    addFiles(jpeg());

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View item" })).toHaveAttribute("href", `/items/${item.id}`);
    expect(uploadItem).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ type: "fabric" }));
  });

  it("rejects unsupported files without contacting the server", async () => {
    renderWithQuery(<UploadPanel />);

    addFiles(new File(["gif"], "anim.gif", { type: "image/gif" }));

    expect(await screen.findByText("Only JPEG, PNG and WebP images are supported.")).toBeInTheDocument();
    expect(uploadItem).not.toHaveBeenCalled();
  });

  it("shows the server's validation message and allows retry", async () => {
    uploadItem.mockRejectedValueOnce(
      new ApiError(422, "invalid_image", "The file is not a readable image."),
    );
    uploadItem.mockResolvedValueOnce(makeItem());
    renderWithQuery(<UploadPanel />);

    addFiles(jpeg("broken.jpg"));
    expect(await screen.findByText("The file is not a readable image.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry broken.jpg" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(uploadItem).toHaveBeenCalledTimes(2);
  });

  it("links duplicates to the copy already in the library", async () => {
    uploadItem.mockRejectedValue(
      new ApiError(409, "conflict", "This image is already in your library.", {
        existing_item_id: "existing-1",
      }),
    );
    renderWithQuery(<UploadPanel />);

    addFiles(jpeg());

    expect(await screen.findByText("Already saved")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the saved copy" })).toHaveAttribute(
      "href",
      "/items/existing-1",
    );
  });
});
