# The desktop app of e2e/gui-preview.spec.ts: fills its (virtual) screen red and turns green once clicked.
import tkinter as tk

root = tk.Tk()
root.overrideredirect(True)
root.geometry(f"{root.winfo_screenwidth()}x{root.winfo_screenheight()}+0+0")
root.configure(bg="#ff0000")


def clicked(_):
    root.configure(bg="#00ff00")
    print("clicked", flush=True)


root.bind("<Button-1>", clicked)
root.mainloop()
