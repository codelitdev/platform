Centered modal on a warm scrim; scrim click closes.

```jsx
<Dialog open={open} onClose={close} title="Delete campaign?" description="This can't be undone."
  footer={<><Button variant="outline" onClick={close}>Keep it</Button><Button variant="destructive">Delete campaign</Button></>} />
```
