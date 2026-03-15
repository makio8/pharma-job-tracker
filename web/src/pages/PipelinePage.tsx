import { Card, Typography, Button, Space } from 'antd';
import { ExperimentOutlined, MailOutlined } from '@ant-design/icons';

const { Title, Paragraph, Text } = Typography;

export default function PipelinePage() {
  return (
    <div style={{ maxWidth: 600, margin: '0 auto', paddingTop: 32 }}>
      <Card>
        <Space direction="vertical" size="large" style={{ width: '100%', textAlign: 'center' }}>
          <ExperimentOutlined style={{ fontSize: 64, color: '#1677ff' }} />

          <Title level={3} style={{ margin: 0 }}>
            パイプライン分析 — 準備中
          </Title>

          <Paragraph type="secondary">
            各製薬企業のパイプライン（開発中の新薬）と採用動向の相関分析を準備しています。
            <br />
            新しいパイプラインが進んでいる領域では、関連職種の求人が増加する傾向があります。
          </Paragraph>

          <Card
            style={{ background: '#f0f7ff', border: '1px solid #91caff' }}
            bodyStyle={{ padding: 16 }}
          >
            <Space direction="vertical">
              <Text strong>📊 予定コンテンツ</Text>
              <ul style={{ textAlign: 'left', margin: 0, paddingLeft: 20 }}>
                <li>各社のパイプラインフェーズ別状況</li>
                <li>疾患領域 × 採用数のヒートマップ</li>
                <li>承認・申請イベントと求人増減の分析</li>
                <li>週次ニュースレター（Substack）</li>
              </ul>
            </Space>
          </Card>

          <Button
            type="primary"
            size="large"
            icon={<MailOutlined />}
            href="#"
            target="_blank"
            rel="noopener noreferrer"
          >
            Substack で最新情報を受け取る
          </Button>

          <Text type="secondary" style={{ fontSize: 12 }}>
            登録は無料です。スパムは送りません。
          </Text>
        </Space>
      </Card>
    </div>
  );
}
