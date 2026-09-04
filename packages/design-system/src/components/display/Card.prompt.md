The standard content surface — border + soft warm shadow + 16px radius; never shadow-only.

```jsx
<Card title="Course details" description="Shown on your public page." footer={<Button>Save changes</Button>}>
  …form fields…
</Card>
```

All sections optional; pass only `children` for a plain surface.
