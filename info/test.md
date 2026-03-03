### 这是一个 Mermaid 渲染测试

```mermaid
graph TD
    A[开始] --> B{是否下雨?}
    B -- 是 --> C[带伞]
    B -- 否 --> D[戴太阳镜]
    C --> E[出门]
    D --> E[出门]
    E --> F[结束]